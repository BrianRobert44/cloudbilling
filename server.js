

const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });


const authRoutes = require("./routes/authRoutes");
const businessRoutes = require("./routes/businessRoutes");
const productRoutes = require("./routes/productRoutes");
const customerRoutes = require("./routes/customerRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const reportRoutes = require("./routes/reportRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const counterRoutes = require("./routes/counterRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const payuPaymentRoutes = require("./routes/payuPaymentRoutes");


const settingsRoutes = require("./routes/settingsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const businessSettingsRoutes = require("./routes/businessSettings");
const superAdminRoutes = require("./routes/superAdminRoutes");
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Rohil Cloud Bill API is running successfully.",
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/products", productRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/payment/payu", payuPaymentRoutes);
app.use("/api/counters", counterRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/business-settings", businessSettingsRoutes);
app.use("/api/super-admin", superAdminRoutes);
const http = require("http");
const { initSocket } = require("./services/socketService");

// Server
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize WebSockets
initSocket(server);

server.listen(PORT, () => {
  console.log(`Rohil Cloud Bill server running on port ${PORT}`);
});
