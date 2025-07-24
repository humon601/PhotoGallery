require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use("/uploads", express.static(uploadsDir));

// --- MySQL 연결 풀 생성 (Railway용) ---
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool
  .getConnection()
  .then((conn) => {
    console.log("✅ Railway MySQL에 성공적으로 연결되었습니다.");
    conn.release();
  })
  .catch((err) => {
    console.error("MySQL 연결 실패:", err);
  });

// ... (이하 모든 API 라우트 코드는 이전 MySQL 버전과 동일합니다) ...

app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
