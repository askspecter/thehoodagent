"use strict";

/**
 * The audit engine.
 *
 * Lives inside the web app because the web app is its only consumer. That keeps
 * `web/` a self-contained Next.js project with no parent-directory dependency —
 * which is what lets it deploy to Vercel with the root directory set to `web`.
 *
 * Every export is read-only: nothing here signs a transaction, holds a key, or
 * spends funds. Safe to run server-side.
 */

module.exports = {
  ...require("./chains"),
  ...require("./selectors"),
  ...require("./bytecode"),
  ...require("./pons"),
  ...require("./simulate"),
  ...require("./audit"),
  ...require("./score"),
};
