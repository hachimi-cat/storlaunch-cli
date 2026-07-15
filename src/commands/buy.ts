import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { buyerRequest, parseSessionCookie, buyerDownload, BuyerApiError } from "../lib/buyer-api.js";
import {
  getBuyerSession, setBuyerSession, clearBuyerSession, listBuyerSessions, requireBuyerSession,
} from "../lib/buyer-config.js";
import { prompt, promptChoice, promptConfirm, closePrompt } from "../lib/prompt.js";
import { output } from "../lib/output.js";
import { buyReferral } from "./referrals.js";

// ─── Top-level `buy` ─────────────────────────────────────────────────────────
export const buy = new Command("buy").description("Buyer commands — shop, pay, track orders");

buy.addCommand(buyReferral);

// ─── auth ────────────────────────────────────────────────────────────────────
const auth = buy.command("auth").description("Manage buyer authentication (per merchant)");

auth
  .command("login")
  .description("Log in to a merchant via email OTP")
  .requiredOption("--merchant <slug>", "Merchant slug (e.g. my-shop)")
  .action(async (opts: { merchant: string }) => {
    try {
      const email = (await prompt("Email:")) || "";
      if (!email) throw new Error("Email is required");

      await buyerRequest(null, "/checkout/verify-email", {
        method: "POST",
        body: { email, accountSlug: opts.merchant },
      });
      console.log(chalk.dim(`Code sent to ${email}. Check your inbox.`));

      const code = (await prompt("6-digit code:")) || "";
      if (!/^\d{6}$/.test(code)) throw new Error("Must be 6 digits");

      const { setCookie } = await buyerRequest(null, "/checkout/verify-otp", {
        method: "POST",
        body: { email, accountSlug: opts.merchant, code },
      });
      const parsed = parseSessionCookie(setCookie);
      if (!parsed) throw new Error("Login succeeded but no session cookie received");

      setBuyerSession({ accountSlug: opts.merchant, email, ...parsed });
      console.log(chalk.green(`✓ Signed in as ${email} for ${opts.merchant}`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exitCode = 1;
    } finally {
      closePrompt();
    }
  });

auth
  .command("logout")
  .description("Clear the buyer session for a merchant")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }) => {
    const session = getBuyerSession(opts.merchant);
    if (!session) {
      console.log(chalk.dim(`Not signed in to ${opts.merchant}.`));
      return;
    }
    try {
      await buyerRequest(opts.merchant, "/checkout/signout", { method: "POST" });
    } catch {
      // Server-side failure is non-fatal — local clear still runs.
    }
    clearBuyerSession(opts.merchant);
    console.log(chalk.green(`✓ Signed out of ${opts.merchant}`));
  });

auth
  .command("whoami")
  .description("Show the currently signed-in buyer for a merchant (or all)")
  .option("--merchant <slug>", "Merchant slug (omit to list all)")
  .action(async (opts: { merchant?: string }) => {
    if (opts.merchant) {
      const s = getBuyerSession(opts.merchant);
      if (!s) { console.log(chalk.dim(`Not signed in to ${opts.merchant}`)); return; }
      console.log(`${chalk.bold(opts.merchant)}: ${s.email} (expires ${s.expiresAt})`);
      return;
    }
    const all = listBuyerSessions();
    if (all.length === 0) { console.log(chalk.dim("No buyer sessions")); return; }
    for (const s of all) {
      console.log(`${chalk.bold(s.accountSlug)}: ${s.email} (expires ${s.expiresAt})`);
    }
  });

// ─── shop / browse ───────────────────────────────────────────────────────────
buy
  .command("shop <merchant> [product]")
  .description("Browse a merchant's products (or view one product)")
  .action(async (merchant: string, productSlug: string | undefined) => {
    try {
      if (productSlug) {
        const { data } = await buyerRequest(null, `/storefront/public/${merchant}/${productSlug}`);
        output(data);
        return;
      }
      const { data } = await buyerRequest(null, `/storefront/public/${merchant}`);
      output(data);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exitCode = 1;
    }
  });

// ─── checkout ────────────────────────────────────────────────────────────────
buy
  .command("checkout <merchant> <product>")
  .description("Buy a product — interactive for physical, direct for digital; opens payment URL")
  .option("--open", "Automatically open the payment URL in the browser", true)
  .option("--no-open", "Print the URL instead of opening the browser")
  .action(async (merchant: string, productSlug: string, opts: { open: boolean }) => {
    try {
      const session = requireBuyerSession(merchant);
      const { data: product } = await buyerRequest(null, `/storefront/public/${merchant}/${productSlug}`) as { data: any };
      if (!product) throw new Error("Product not found");

      const isPhysical = product.type === "physical";
      const body: Record<string, unknown> = { email: session.email };

      if (isPhysical) {
        // Address picker
        const { data: addresses } = await buyerRequest(merchant, `/checkout/addresses`, {
          query: { accountSlug: merchant },
        }) as { data: any[] };
        if (addresses.length === 0) {
          console.log(chalk.yellow("No saved addresses. Run: storlaunch buy addresses add --merchant " + merchant));
          return;
        }
        const picked = await promptChoice(
          "Pick an address:",
          addresses.map((a) => ({
            ...a,
            label: `${a.label} — ${a.contactName}, ${a.address}${a.isDefault ? " [default]" : ""}`,
          })),
        );
        if (!picked) return;

        // Rate quote
        const { data: rates } = await buyerRequest(null, `/shipping/rates`, {
          method: "POST",
          body: {
            accountSlug: merchant,
            destination: {
              contactName: picked.contactName, contactPhone: picked.contactPhone, email: session.email,
              address: picked.address, note: picked.note, postalCode: picked.postalCode,
              areaId: picked.areaId, lat: picked.lat, lng: picked.lng,
            },
            items: [{
              productId: product.id, name: product.name, value: product.price,
              weight: Math.max(1, product.weight ?? 1), quantity: 1,
            }],
          },
        }) as { data: { rates: any[] } };
        if (!rates.rates?.length) {
          console.log(chalk.yellow("No couriers available for this address."));
          return;
        }
        const rate = await promptChoice(
          "Pick a courier:",
          rates.rates.map((r) => ({
            ...r,
            label: `${r.courier_name} · ${r.courier_service_name} — ${fmtIDR(r.price)} (${r.duration})`,
          })),
        );
        if (!rate) return;

        body.shipping = {
          destination: {
            contactName: picked.contactName, contactPhone: picked.contactPhone, email: session.email,
            address: picked.address, note: picked.note, postalCode: picked.postalCode,
            areaId: picked.areaId, lat: picked.lat, lng: picked.lng,
          },
          courierCode: rate.courier_code,
          courierService: rate.courier_service_code,
          courierType: rate.service_type,
          shippingCost: rate.price,
          insured: false,
          insuranceValue: product.price,
          addressId: picked.id,
        };

        const total = product.price + rate.price;
        const ok = await promptConfirm(`Total: ${fmtIDR(total)}. Confirm?`);
        if (!ok) { console.log(chalk.dim("Cancelled.")); return; }
      } else {
        const ok = await promptConfirm(`Buy ${product.name} for ${fmtIDR(product.price)}?`);
        if (!ok) { console.log(chalk.dim("Cancelled.")); return; }
      }

      const { data: result } = await buyerRequest(null, `/storefront/public/${merchant}/${productSlug}/checkout`, {
        method: "POST",
        body,
      }) as { data: { checkoutUrl: string } };

      console.log(chalk.green("\n✓ Checkout created"));
      console.log(`Pay here: ${chalk.cyan(result.checkoutUrl)}`);
      if (opts.open) openBrowser(result.checkoutUrl);
    } catch (err) {
      if (err instanceof BuyerApiError && err.status === 401) {
        console.error(chalk.red(`Not signed in. Run: storlaunch buy auth login --merchant ${merchant}`));
      } else {
        console.error(chalk.red((err as Error).message));
      }
      process.exitCode = 1;
    } finally {
      closePrompt();
    }
  });

// ─── orders ──────────────────────────────────────────────────────────────────
const orders = buy.command("orders").description("Your orders with a merchant");

orders
  .command("list")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .description("List your orders")
  .action(async (opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/orders`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

orders
  .command("get <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .description("Show a single order with shipment + deliveries + invoice")
  .action(async (id: string, opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/orders/${id}`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

// ─── subscriptions ───────────────────────────────────────────────────────────
const subs = buy.command("subs").description("Your subscriptions with a merchant");

subs
  .command("list")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/subscriptions`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

subs
  .command("get <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (id: string, opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/subscriptions/${id}`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

subs
  .command("cancel <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--immediate", "Cancel right now instead of at period end", false)
  .description("Cancel a subscription (end-of-period by default)")
  .action(async (id: string, opts: { merchant: string; immediate: boolean }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/subscriptions/${id}/cancel`, {
        method: "POST",
        body: { accountSlug: opts.merchant, immediate: opts.immediate },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

// ─── invoices ────────────────────────────────────────────────────────────────
const invoices = buy.command("invoices").description("Your invoices from a merchant");

invoices
  .command("list")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/invoices`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

invoices
  .command("download <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--out <path>", "Write to a file path (default: ./invoice-<id>.pdf)")
  .description("Download an invoice PDF")
  .action(async (id: string, opts: { merchant: string; out?: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const buf = await buyerDownload(opts.merchant, `/checkout/invoices/${id}/pdf?download=1`);
      const path = opts.out ?? `./invoice-${id}.pdf`;
      writeFileSync(path, buf);
      console.log(chalk.green(`✓ Saved to ${path}`));
    } catch (err) { errExit(err); }
  });

// ─── addresses ───────────────────────────────────────────────────────────────
const addresses = buy.command("addresses").description("Your saved addresses for a merchant");

addresses
  .command("list")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/addresses`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

addresses
  .command("add")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--label <label>", "Label (e.g. Home, Office)", "Home")
  .requiredOption("--name <name>", "Contact name")
  .requiredOption("--phone <phone>", "Contact phone")
  .requiredOption("--address <address>", "Street address")
  .option("--postal <code>", "Postal code")
  .option("--lat <lat>", "Latitude (required for instant couriers)", parseFloat)
  .option("--lng <lng>", "Longitude", parseFloat)
  .option("--note <note>", "Delivery note")
  .option("--default", "Mark this as the default address", false)
  .description("Add a new address")
  .action(async (opts: {
    merchant: string; label: string; name: string; phone: string; address: string;
    postal?: string; lat?: number; lng?: number; note?: string; default?: boolean;
  }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/addresses`, {
        method: "POST",
        body: {
          accountSlug: opts.merchant,
          label: opts.label, contactName: opts.name, contactPhone: opts.phone,
          address: opts.address, postalCode: opts.postal, note: opts.note,
          lat: opts.lat, lng: opts.lng, isDefault: opts.default ?? false,
        },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

addresses
  .command("edit <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--label <label>")
  .option("--name <name>")
  .option("--phone <phone>")
  .option("--address <address>")
  .option("--postal <code>")
  .option("--lat <lat>", "", parseFloat)
  .option("--lng <lng>", "", parseFloat)
  .option("--note <note>")
  .description("Update fields on an existing address")
  .action(async (id: string, opts: any) => {
    try {
      requireBuyerSession(opts.merchant);
      const body: Record<string, unknown> = { accountSlug: opts.merchant };
      if (opts.label !== undefined) body.label = opts.label;
      if (opts.name !== undefined) body.contactName = opts.name;
      if (opts.phone !== undefined) body.contactPhone = opts.phone;
      if (opts.address !== undefined) body.address = opts.address;
      if (opts.postal !== undefined) body.postalCode = opts.postal;
      if (opts.lat !== undefined) body.lat = opts.lat;
      if (opts.lng !== undefined) body.lng = opts.lng;
      if (opts.note !== undefined) body.note = opts.note;
      const { data } = await buyerRequest(opts.merchant, `/checkout/addresses/${id}`, {
        method: "PATCH", body,
      });
      output(data);
    } catch (err) { errExit(err); }
  });

addresses
  .command("delete <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (id: string, opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      await buyerRequest(opts.merchant, `/checkout/addresses/${id}`, {
        method: "DELETE", query: { accountSlug: opts.merchant },
      });
      console.log(chalk.green("✓ Address deleted"));
    } catch (err) { errExit(err); }
  });

addresses
  .command("default <id>")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .description("Mark an address as default")
  .action(async (id: string, opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/addresses/${id}/default`, {
        method: "POST", body: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

// ─── profile ─────────────────────────────────────────────────────────────────
const profile = buy.command("profile").description("Your profile with a merchant");

profile
  .command("show")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/profile`, {
        query: { accountSlug: opts.merchant },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

profile
  .command("update")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--name <name>", "New display name")
  .description("Update profile fields (name only; change-email is a separate OTP flow)")
  .action(async (opts: { merchant: string; name?: string }) => {
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest(opts.merchant, `/checkout/profile`, {
        method: "PATCH", body: { accountSlug: opts.merchant, name: opts.name ?? null },
      });
      output(data);
    } catch (err) { errExit(err); }
  });

// ─── Cart (Phase G) ──────────────────────────────────────────────────────
const cart = buy.command("cart").description("Manage your cart with a merchant");

cart
  .command("list")
  .description("Show the current cart")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts) => {
    try {
      const { data } = await buyerRequest(opts.merchant, `/checkout/cart`, { query: { accountSlug: opts.merchant } });
      const c = data as { items?: Array<{ id: string; product: { name: string; slug: string }; variant: { name: string | null } | null; quantity: number; unitPrice: number; lineTotal: number }>; subtotal?: number; itemCount?: number; currency?: string };
      if (!c.items || c.items.length === 0) {
        console.log(chalk.dim("Cart is empty."));
        return;
      }
      for (const it of c.items) {
        const variant = it.variant?.name ? ` · ${it.variant.name}` : "";
        console.log(`  ${chalk.dim(it.id.slice(0, 14))}  ${it.product.name}${variant}  × ${it.quantity}  = ${fmtIDR(it.lineTotal)}`);
      }
      console.log(chalk.bold(`\nTotal: ${fmtIDR(c.subtotal ?? 0)} (${c.itemCount ?? 0} items)`));
    } catch (err) { errExit(err); }
  });

cart
  .command("add")
  .description("Add a product (or variant) to the cart")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .requiredOption("--product <slug>", "Product slug")
  .option("--variant <id>", "Variant ID (required for products with variants)")
  .option("--quantity <n>", "How many to add", (v) => parseInt(v, 10), 1)
  .option("--note <text>", "Note for the seller (gift wrap, size, etc.)")
  .action(async (opts) => {
    try {
      const { data } = await buyerRequest(opts.merchant, `/checkout/cart/items`, {
        method: "POST",
        body: {
          accountSlug: opts.merchant,
          productSlug: opts.product,
          variantId: opts.variant ?? null,
          quantity: opts.quantity,
          ...(opts.note ? { note: opts.note } : {}),
        },
      });
      const c = data as { itemCount?: number };
      console.log(chalk.green(`Added. Cart now has ${c.itemCount ?? 0} item(s).`));
    } catch (err) { errExit(err); }
  });

cart
  .command("note")
  .description("Update the note on an existing cart item")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .requiredOption("--item <id>", "Cart item ID (from `buy cart list`)")
  .option("--text <text>", "Note text (omit to clear)")
  .action(async (opts) => {
    try {
      await buyerRequest(opts.merchant, `/checkout/cart/items/${opts.item}`, {
        method: "PATCH",
        body: {
          accountSlug: opts.merchant,
          note: opts.text ?? null,
        },
      });
      console.log(chalk.green(opts.text ? "Note updated." : "Note cleared."));
    } catch (err) { errExit(err); }
  });

cart
  .command("remove")
  .description("Remove a line item")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .requiredOption("--item <id>", "Cart item ID (from `buy cart list`)")
  .action(async (opts) => {
    try {
      await buyerRequest(opts.merchant, `/checkout/cart/items/${opts.item}`, {
        method: "DELETE",
        query: { accountSlug: opts.merchant },
      });
      console.log(chalk.green("Removed."));
    } catch (err) { errExit(err); }
  });

cart
  .command("clear")
  .description("Empty the cart")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts) => {
    try {
      await buyerRequest(opts.merchant, `/checkout/cart`, {
        method: "DELETE",
        query: { accountSlug: opts.merchant },
      });
      console.log(chalk.green("Cart cleared."));
    } catch (err) { errExit(err); }
  });

cart
  .command("checkout")
  .description("Create a multi-item checkout session from the current cart")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--email <email>", "Buyer email (defaults to signed-in buyer's email)")
  .option("--discount-code <code>", "Apply a discount code")
  .option("--no-open", "Don't open the payment URL in a browser")
  .action(async (opts) => {
    try {
      // Fetch cart to get items
      const { data: cartData } = await buyerRequest(opts.merchant, `/checkout/cart`, {
        query: { accountSlug: opts.merchant },
      });
      const c = cartData as { items?: Array<{ productId: string; variantId: string | null; quantity: number; productType?: string }> };
      if (!c.items || c.items.length === 0) {
        console.error(chalk.red("Cart is empty"));
        process.exitCode = 1;
        return;
      }
      if (c.items.some((i) => i.productType === 'physical')) {
        console.error(chalk.red("Cart contains physical items — multi-item shipping checkout is coming next. Use `buy checkout` per product for now."));
        process.exitCode = 1;
        return;
      }

      // Resolve buyer email if not passed
      let email = opts.email as string | undefined;
      if (!email) {
        try {
          const { data: me } = await buyerRequest(opts.merchant, `/checkout/me`, { query: { accountSlug: opts.merchant } });
          email = (me as { email?: string }).email;
        } catch { /* anon */ }
      }
      if (!email) {
        console.error(chalk.red("--email required (or sign in first via `buy auth login`)"));
        process.exitCode = 1;
        return;
      }

      const body: Record<string, unknown> = {
        email,
        items: c.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
      };
      if (opts.discountCode) body.discountCode = opts.discountCode;

      const { data: session } = await buyerRequest(null, `/storefront/public/${opts.merchant}/cart-checkout`, {
        method: "POST",
        body,
      });
      const s = session as { sessionId?: string; checkoutUrl?: string };
      if (!s.checkoutUrl) {
        console.error(chalk.red("No checkoutUrl returned"));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`Checkout session: ${s.sessionId}`));
      console.log(chalk.bold(`Pay here: ${s.checkoutUrl}`));
      if (opts.open !== false) openBrowser(s.checkoutUrl);

      // Best-effort cart clear for authed buyers (server-side cart only).
      try {
        await buyerRequest(opts.merchant, `/checkout/cart`, {
          method: "DELETE",
          query: { accountSlug: opts.merchant },
        });
      } catch { /* ignore — cart may already be empty or buyer not authed */ }
    } catch (err) { errExit(err); }
  });

// ─── helpers ─────────────────────────────────────────────────────────────────

function errExit(err: unknown): void {
  if (err instanceof BuyerApiError) {
    if (err.status === 401) console.error(chalk.red("Not signed in — run: storlaunch buy auth login --merchant <slug>"));
    else console.error(chalk.red(`${err.message} (HTTP ${err.status})`));
  } else {
    console.error(chalk.red((err as Error).message));
  }
  process.exitCode = 1;
}

function fmtIDR(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Opening the browser is best-effort — user already sees the URL.
  }
}
