const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || "cloudbill_super_secret_key_2026",
  PAYU_MERCHANT_KEY: process.env.PAYU_MERCHANT_KEY || "gtKFFx",
  PAYU_MERCHANT_SALT: process.env.PAYU_MERCHANT_SALT || "eCwWELxi",
  PAYU_ENV: process.env.PAYU_ENV || "test",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
  BACKEND_URL: process.env.BACKEND_URL || "http://localhost:5000",
};
