/**
 * Cloud Firestore Database Engine & Adapter
 * Replaces MySQL completely with Google Cloud Firestore (Firebase).
 */

const { getFirestore, isConfigured } = require("./firebase");
const alasql = require("alasql");

const firestore = getFirestore();

// Register SQL helper functions for AlaSQL
alasql.fn.CURDATE = () => new Date().toISOString().slice(0, 10);
alasql.fn.NOW = () => new Date().toISOString().slice(0, 19).replace("T", " ");
alasql.fn.COALESCE = (...args) =>
  args.find((a) => a !== null && a !== undefined) ?? null;
alasql.fn.GREATEST = (...args) => Math.max(...args.map((a) => Number(a) || 0));
alasql.fn.LEAST = (...args) => Math.min(...args.map((a) => Number(a) || 0));
alasql.fn.DATE_ADD = (date, interval) => {
  const d = new Date(date || Date.now());
  const num =
    typeof interval === "string"
      ? parseInt(interval, 10) || 7
      : Number(interval) || 7;
  d.setDate(d.getDate() + num);
  return d.toISOString().slice(0, 10);
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
alasql.fn.MONTH = (date) => {
  if (!date) return 1;
  const d = new Date(date);
  return isNaN(d.getTime()) ? 1 : d.getMonth() + 1;
};
alasql.fn.YEAR = (date) => {
  if (!date) return new Date().getFullYear();
  const d = new Date(date);
  return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
};
alasql.fn.MONTHNAME = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return isNaN(d.getTime()) ? "" : MONTH_NAMES[d.getMonth()] || "";
};
alasql.fn.DATE_FORMAT = (date, format) => {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (format === "%Y-%m-01") return `${yyyy}-${mm}-01`;
  if (format === "%Y-01-01") return `${yyyy}-01-01`;
  if (format === "%Y-%m") return `${yyyy}-${mm}`;
  if (format === "%Y-%m-%d") return `${yyyy}-${mm}-${dd}`;
  return `${yyyy}-${mm}-${dd}`;
};

const COLLECTIONS = [
  "users",
  "businesses",
  "products",
  "customers",
  "vendors",
  "purchases",
  "purchase_items",
  "invoices",
  "invoice_items",
  "payments_received",
  "expenses",
  "subscriptions",
  "subscription_payments",
  "business_settings",
  "system_settings",
  "login_activity",
  "counters",
];

const ID_FIELDS = [
  "id",
  "user_id",
  "business_id",
  "customer_id",
  "vendor_id",
  "purchase_id",
  "product_id",
  "invoice_id",
  "counter_id",
];

// Initialize in-memory tables
for (const col of COLLECTIONS) {
  alasql(`CREATE TABLE IF NOT EXISTS ${col}`);
  alasql.tables[col].data = [];
}

let syncPromise = null;

async function syncAllFromFirestore() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      for (const col of COLLECTIONS) {
        const snapshot = await firestore.collection(col).get();
        const records = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const numId = Number(doc.id);
          const id = Number.isSafeInteger(numId) && numId > 0 ? numId : doc.id;
          const record = { ...data, id: data.id !== undefined ? data.id : id };

          // Normalize ID fields for consistent typing
          for (const field of ID_FIELDS) {
            if (
              record[field] !== undefined &&
              record[field] !== null &&
              record[field] !== ""
            ) {
              const numVal = Number(record[field]);
              if (Number.isSafeInteger(numVal)) {
                record[field] = numVal;
              }
            }
          }

          records.push(record);
        });

        alasql(`CREATE TABLE IF NOT EXISTS ${col}`);
        alasql.tables[col].data = records;
      }
      console.log(
        "All collections loaded from Cloud Firestore into in-memory database."
      );
    } catch (err) {
      console.error("Firestore sync error:", err.message);
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

// Start initial sync
syncAllFromFirestore();

function getNextId(table) {
  const data = alasql.tables[table]?.data || [];
  let maxId = 0;
  for (const row of data) {
    const idNum = Number(row.id);
    if (Number.isFinite(idNum) && idNum > maxId) {
      maxId = idNum;
    }
  }
  return maxId + 1;
}

function cleanSql(sql) {
  return sql
    .replace(/FOR\s+UPDATE/gi, "")
    .replace(
      /DATE_ADD\s*\(\s*CURDATE\(\)\s*,\s*INTERVAL\s*(\d+)\s*DAY\s*\)/gi,
      "DATE_ADD(CURDATE(), $1)"
    )
    .trim();
}

function extractTableName(sql) {
  const match = sql.match(
    /(?:FROM|INTO|UPDATE)\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i
  );
  return match ? match[1].toLowerCase() : null;
}

function normalizeParams(params) {
  return (params || []).map((p) => {
    if (typeof p === "string" && p.trim() !== "" && !isNaN(p)) {
      const num = Number(p);
      if (Number.isSafeInteger(num)) {
        return num;
      }
    }
    return p;
  });
}

async function executeQuery(sql, params = []) {
  if (!alasql.tables.users?.data?.length) {
    await syncAllFromFirestore();
  }

  const cleaned = cleanSql(sql);
  const normalized = normalizeParams(params);
  const table = extractTableName(cleaned);
  const isInsert = /^\s*INSERT\s+INTO/i.test(cleaned);
  const isUpdate = /^\s*UPDATE\s+/i.test(cleaned);
  const isDelete = /^\s*DELETE\s+FROM/i.test(cleaned);

  // Handle INSERT
  if (isInsert && table) {
    const colDefMatch = cleaned.match(
      /INSERT\s+INTO\s+[`"']?[a-zA-Z0-9_]+[`"']?\s*\(([^)]+)\)\s*VALUES/i
    );
    let id = getNextId(table);

    if (colDefMatch) {
      const colNames = colDefMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/[`"']/g, ""));
      const newRecord = { id };
      for (let i = 0; i < colNames.length; i++) {
        let val = normalized[i] !== undefined ? normalized[i] : null;
        if (ID_FIELDS.includes(colNames[i]) && val !== null && !isNaN(val)) {
          const num = Number(val);
          if (Number.isSafeInteger(num)) val = num;
        }
        newRecord[colNames[i]] = val;
      }

      if (newRecord.id && Number.isFinite(Number(newRecord.id))) {
        id = Number(newRecord.id);
      } else {
        newRecord.id = id;
      }

      if (!newRecord.created_at) {
        newRecord.created_at = new Date().toISOString();
      }

      alasql.tables[table].data.push(newRecord);

      // Persist to Cloud Firestore
      await firestore.collection(table).doc(String(id)).set(newRecord);

      return [{ insertId: id, affectedRows: 1 }, []];
    }
  }

  // Handle DELETE
  if (isDelete && table) {
    let selectSql = cleaned.replace(/^\s*DELETE\s+FROM/i, "SELECT id FROM");
    let toDelete = [];
    try {
      toDelete = alasql(selectSql, normalized);
    } catch (e) {
      toDelete = [];
    }

    const result = alasql(cleaned, normalized);
    const affectedRows = typeof result === "number" ? result : toDelete.length;

    // Delete in Firestore
    const batch = firestore.batch();
    for (const doc of toDelete) {
      if (doc.id != null) {
        batch.delete(firestore.collection(table).doc(String(doc.id)));
      }
    }
    await batch.commit();

    return [{ affectedRows }, []];
  }

  // Handle UPDATE
  if (isUpdate && table) {
    const setWhereMatch = cleaned.match(/SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
    let targetIds = [];
    if (setWhereMatch) {
      const setClause = setWhereMatch[1];
      const whereClause = setWhereMatch[2];
      const setParamCount = (setClause.match(/\?/g) || []).length;
      const whereParams = normalized.slice(setParamCount);
      try {
        const whereRows = alasql(
          `SELECT id FROM ${table} WHERE ${whereClause}`,
          whereParams
        );
        targetIds = whereRows.map((r) => r.id);
      } catch (e) {
        // Fallback
      }
    } else {
      const whereMatch = cleaned.match(/WHERE\s+([\s\S]+)$/i);
      if (whereMatch) {
        try {
          const whereRows = alasql(
            `SELECT id FROM ${table} WHERE ${whereMatch[1]}`,
            normalized
          );
          targetIds = whereRows.map((r) => r.id);
        } catch (e) {
          // Fallback
        }
      }
    }

    const result = alasql(cleaned, normalized);
    const affected =
      typeof result === "number" ? result : targetIds.length || 1;

    // Persist updated records to Firestore
    if (targetIds.length > 0) {
      const batch = firestore.batch();
      for (const id of targetIds) {
        const updatedRow = (alasql.tables[table]?.data || []).find(
          (r) => r.id === id
        );
        if (updatedRow) {
          batch.set(
            firestore.collection(table).doc(String(id)),
            updatedRow,
            { merge: true }
          );
        }
      }
      await batch.commit();
    } else {
      const allRows = alasql.tables[table]?.data || [];
      const batch = firestore.batch();
      for (const row of allRows.slice(0, 100)) {
        if (row.id != null) {
          batch.set(
            firestore.collection(table).doc(String(row.id)),
            row,
            { merge: true }
          );
        }
      }
      await batch.commit();
    }

    return [{ affectedRows: affected, changedRows: affected }, []];
  }

  // Handle SELECT / READ queries
  try {
    const rows = alasql(cleaned, normalized);
    return [rows, []];
  } catch (err) {
    console.error("AlaSQL Error on query:", cleaned, err.message);
    throw err;
  }
}

class TransactionConnection {
  async beginTransaction() {
    this.inTransaction = true;
  }

  async commit() {
    this.inTransaction = false;
  }

  async rollback() {
    this.inTransaction = false;
    await syncAllFromFirestore();
  }

  release() {
    // Connection released
  }

  async query(sql, params) {
    return executeQuery(sql, params);
  }

  async execute(sql, params) {
    return executeQuery(sql, params);
  }
}

const db = {
  query: executeQuery,
  execute: executeQuery,
  getConnection: async () => new TransactionConnection(),
  syncFromFirestore: syncAllFromFirestore,
};

module.exports = db;
