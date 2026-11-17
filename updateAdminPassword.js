const bcrypt = require("bcryptjs");
const db = require("./config/db");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter Admin Email (default: admin@gmail.com): ", (emailInput) => {
  const targetEmail = (emailInput || "admin@gmail.com").trim().toLowerCase();

  rl.question("Enter new Admin password: ", async (password) => {
    try {
      if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const [result] = await db.query(
        `UPDATE users
         SET password = ?
         WHERE LOWER(email) = ?
         AND UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')`,
        [hashedPassword, targetEmail]
      );

      if (!result || result.affectedRows === 0) {
        console.log(`Admin account not found with email: ${targetEmail}`);
      } else {
        console.log(`Password for admin (${targetEmail}) updated successfully in Firebase Firestore.`);
      }
    } catch (error) {
      console.error("Error:", error.message);
    } finally {
      rl.close();
      if (typeof db.end === "function") {
        await db.end();
      }
      process.exit(0);
    }
  });
});
