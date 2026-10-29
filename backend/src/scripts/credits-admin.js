// Turn WhatsApp / SMS credits on for an organization, or gift credits.
//   node src/scripts/credits-admin.js enable <organizationId> [bonusCredits]
//   node src/scripts/credits-admin.js enable-all [bonusCredits]      (every organization; only after you reprice the plans)
//   node src/scripts/credits-admin.js show <organizationId>
import mongoose from "mongoose";
import { loadEnv } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { enable, getBalance, grantBonus } from "../modules/credits/credits.service.js";

const [cmd, arg, bonusArg] = process.argv.slice(2);
await mongoose.connect(loadEnv().mongoUri);
if (cmd === "enable" || cmd === "enable-all") {
  const bonus = Number(cmd === "enable" ? bonusArg : arg) || 0;
  const ids = cmd === "enable" ? [arg] : (await Organization.find().select("_id")).map((o) => o._id);
  for (const id of ids) {
    await enable(id);
    if (bonus) await grantBonus(id, { credits: bonus, refId: `gift:${id}:${Date.now()}`, note: "Gift" });
  }
  console.log(`credits enabled for ${ids.length} organization(s)` + (bonus ? `, +${bonus} bonus each` : ""));
} else if (cmd === "show") {
  console.log(await getBalance(arg));
} else {
  console.log("usage: enable <organizationId> [bonus] | enable-all [bonus] | show <organizationId>");
}
await mongoose.disconnect();
