import { Command } from "commander";
import { auth } from "./auth.js";
import { payment } from "./payment.js";
import { storefront } from "./storefront.js";
import { webhook } from "./webhook.js";
import { config } from "./config.js";
import { inventory } from "./inventory.js";
import { shipping } from "./shipping.js";
import { ledger } from "./ledger.js";
import { reports } from "./reports.js";
import { payouts } from "./payouts.js";
import { discountCodes } from "./discount-codes.js";
import { seo } from "./seo.js";
import { pixels } from "./pixels.js";
import { abandonedCart } from "./abandoned-cart.js";
import { feeds } from "./feeds.js";
import { blog } from "./blog.js";
import { referralProgram } from "./referrals.js";
import { apiKeys } from "./api-keys.js";
import { auditLog } from "./audit-log.js";
import { domains } from "./domains.js";
import { settings } from "./settings.js";
import { modules } from "./modules.js";
import { workspace } from "./workspace.js";

/**
 * `sell` — seller-side commands. Wraps existing command modules as
 * subcommands. 0.3.0 adds inventory (variants/warehouses/stock) and
 * shipping (origin/couriers/shipments/track) for physical commerce.
 */
export const sell = new Command("sell").description("Seller commands — manage your merchant account");

sell.addCommand(auth);
sell.addCommand(payment);
sell.addCommand(storefront);
sell.addCommand(inventory);
sell.addCommand(shipping);
sell.addCommand(ledger);
sell.addCommand(reports);
sell.addCommand(payouts);
sell.addCommand(discountCodes);
sell.addCommand(seo);
sell.addCommand(pixels);
sell.addCommand(abandonedCart);
sell.addCommand(feeds);
sell.addCommand(blog);
sell.addCommand(referralProgram);
sell.addCommand(webhook);
sell.addCommand(apiKeys);
sell.addCommand(auditLog);
sell.addCommand(domains);
sell.addCommand(settings);
sell.addCommand(modules);
sell.addCommand(workspace);
sell.addCommand(config);
