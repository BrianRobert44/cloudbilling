require("dotenv").config();
const mysql = require("../config/db");
const { getFirestore, isConfigured } = require("../config/firebase");

async function migrate() {
  if (!isConfigured()) {
    console.error(
      "ERROR: Firebase is not configured. Please place 'serviceAccountKey.json' in backend/ or set FIREBASE_SERVICE_ACCOUNT in .env."
    );
    process.exit(1);
  }

  const firestore = getFirestore();
  console.log("Starting data migration from MySQL to Firebase Firestore...\n");

  const tables = [
    { table: "users", collection: "users" },
    { table: "businesses", collection: "businesses" },
    { table: "products", collection: "products" },
    { table: "customers", collection: "customers" },
    { table: "invoices", collection: "invoices" },
    { table: "invoice_items", collection: "invoice_items" },
    { table: "payments_received", collection: "payments_received" },
    { table: "expenses", collection: "expenses" },
    { table: "subscription_payments", collection: "subscription_payments" },
    { table: "business_settings", collection: "business_settings" },
    { table: "system_settings", collection: "system_settings" },
    { table: "login_activity", collection: "login_activity" },
  ];

  for (const { table, collection } of tables) {
    try {
      const [rows] = await mysql.query(`SELECT * FROM \`${table}\``);
      console.log(`Migrating ${rows.length} rows from table '${table}' -> Firestore collection '${collection}'...`);

      const batchSize = 400;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = rows.slice(i, i + batchSize);

        for (const row of chunk) {
          const docId = String(row.id || row.user_id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
          const docRef = firestore.collection(collection).doc(docId);
          
          // Format row object to clean JS primitives
          const cleanData = {};
          for (const [key, value] of Object.entries(row)) {
            if (value instanceof Date) {
              cleanData[key] = value.toISOString();
            } else if (value !== undefined) {
              cleanData[key] = value;
            }
          }

          batch.set(docRef, cleanData, { merge: true });
        }

        await batch.commit();
      }
      console.log(`✓ Completed '${collection}'\n`);
    } catch (err) {
      if (err.code === "ER_NO_SUCH_TABLE") {
        console.warn(`Table '${table}' does not exist in MySQL, skipping.`);
      } else {
        console.error(`Error migrating table '${table}':`, err.message);
      }
    }
  }

  console.log("🎉 Firebase migration finished successfully!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

