// .env 파일의 환경 변수를 로드합니다.
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise"); // mysql2 라이브러리 사용

const app = express();
const PORT = process.env.PORT || 4000;

// --- 미들웨어 설정 ---
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// --- MySQL 연결 풀 생성 (Railway용) ---
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  ssl: { rejectUnauthorized: true },
});

// --- 파일 업로드 설정 ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(uploadsDir, file.fieldname);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// --- API 라우트 ---

// 회원가입
app.post("/api/signup", async (req, res) => {
  try {
    const { username, password, question, answer } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);

    if (rows.length > 0) {
      return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
    }

    const profilePic = `https://placehold.co/192x192/EFEFEF/3A3A3A?text=${username.charAt(
      0
    )}`;
    await pool.query(
      "INSERT INTO users (username, password, question, answer, profilePic) VALUES (?, ?, ?, ?, ?)",
      [username, password, question, answer, profilePic]
    );
    res.status(201).json({ message: "회원가입 성공!" });
  } catch (error) {
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 로그인
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);

    if (rows.length === 0) {
      return res.status(401).json({ message: "존재하지 않는 아이디입니다." });
    }

    const user = rows[0];
    if (user.password !== password) {
      return res
        .status(401)
        .json({
          needsRecovery: true,
          question: user.question,
          message: "비밀번호가 틀렸습니다.",
        });
    }

    delete user.password;
    delete user.question;
    delete user.answer;
    res.status(200).json({ message: "로그인 성공!", user });
  } catch (error) {
    res.status(500).json({ message: "서버 오류" });
  }
});

// 비밀번호 찾기 (질문/답변 확인)
app.post("/api/login/recover", async (req, res) => {
  try {
    const { username, answer } = req.body;
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username = ? AND answer = ?",
      [username, answer]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "답변이 올바르지 않습니다." });
    }
    const user = rows[0];
    delete user.password;
    delete user.question;
    delete user.answer;
    res.status(200).json({ message: "로그인 성공!", user: user });
  } catch (error) {
    res.status(500).json({ message: "서버 오류" });
  }
});

// 모든 사진 가져오기
app.get("/api/photos", async (req, res) => {
  try {
    const [photos] = await pool.query(`
            SELECT p.*, 
                   (SELECT JSON_ARRAYAGG(u.username) FROM likes l JOIN users u ON l.userId = u.id WHERE l.photoId = p.id) as likes
            FROM photos p
            ORDER BY p.createdAt DESC
        `);
    photos.forEach((p) => {
      p.likes = p.likes || [];
      if (typeof p.tags === "string") p.tags = JSON.parse(p.tags);
    });
    res.status(200).json(photos);
  } catch (error) {
    res.status(500).json({ message: "사진을 불러오지 못했습니다." });
  }
});

// 사진 업로드
app.post("/api/photos/upload", upload.single("photo"), async (req, res) => {
  try {
    const { uploader, title, tags, description } = req.body;
    if (!req.file)
      return res.status(400).json({ message: "사진 파일이 필요합니다." });

    const url = `/uploads/photo/${req.file.filename}`;
    const tagsJson = JSON.stringify(
      tags ? tags.split(",").map((t) => t.trim()) : []
    );

    const [result] = await pool.query(
      "INSERT INTO photos (uploader, url, title, tags, description) VALUES (?, ?, ?, ?, ?)",
      [uploader, url, title, tagsJson, description]
    );
    res
      .status(201)
      .json({ message: "사진이 업로드되었습니다.", photoId: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "업로드 실패" });
  }
});

// 사진 공감
app.post("/api/photos/like", async (req, res) => {
  try {
    const { photoId, username } = req.body;
    const [userRows] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );
    if (userRows.length === 0)
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    const userId = userRows[0].id;

    const [likeRows] = await pool.query(
      "SELECT * FROM likes WHERE userId = ? AND photoId = ?",
      [userId, photoId]
    );

    if (likeRows.length > 0) {
      await pool.query("DELETE FROM likes WHERE userId = ? AND photoId = ?", [
        userId,
        photoId,
      ]);
    } else {
      await pool.query("INSERT INTO likes (userId, photoId) VALUES (?, ?)", [
        userId,
        photoId,
      ]);
    }
    res.status(200).json({ message: "처리 완료" });
  } catch (error) {
    res.status(500).json({ message: "처리 실패" });
  }
});

// 사진 삭제
app.delete("/api/photos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM photos WHERE id = ?", [id]);
    res.status(200).json({ message: "사진이 삭제되었습니다." });
  } catch (error) {
    res.status(500).json({ message: "삭제 실패" });
  }
});

// 사진 정보 수정
app.put("/api/photos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, tags, description } = req.body;
    const tagsJson = JSON.stringify(
      tags ? tags.split(",").map((t) => t.trim()) : []
    );
    await pool.query(
      "UPDATE photos SET title = ?, tags = ?, description = ? WHERE id = ?",
      [title, tagsJson, description, id]
    );
    res.status(200).json({ message: "사진 정보가 수정되었습니다." });
  } catch (error) {
    res.status(500).json({ message: "수정 실패" });
  }
});

// 사용자 정보 가져오기 (프로필 페이지용)
app.get("/api/users/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const [rows] = await pool.query(
      "SELECT id, username, profilePic FROM users WHERE username = ?",
      [username]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "서버 오류" });
  }
});

// 프로필 사진 업로드
app.post(
  "/api/profile/upload",
  upload.single("profilePic"),
  async (req, res) => {
    try {
      const { username } = req.body;
      if (!req.file)
        return res.status(400).json({ message: "파일이 없습니다." });
      const profilePicUrl = `/uploads/profilePic/${req.file.filename}`;
      await pool.query("UPDATE users SET profilePic = ? WHERE username = ?", [
        profilePicUrl,
        username,
      ]);
      res
        .status(200)
        .json({ message: "프로필 사진이 업데이트되었습니다.", profilePicUrl });
    } catch (error) {
      res.status(500).json({ message: "업로드 실패" });
    }
  }
);

// 사용자 이름 변경
app.post("/api/users/update", async (req, res) => {
  try {
    const { oldUsername, newUsername } = req.body;
    if (oldUsername === newUsername)
      return res.status(200).json({ message: "이름이 변경되었습니다." });

    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [
      newUsername,
    ]);
    if (rows.length > 0)
      return res.status(400).json({ message: "이미 사용 중인 이름입니다." });

    await pool.query("UPDATE users SET username = ? WHERE username = ?", [
      newUsername,
      oldUsername,
    ]);
    await pool.query("UPDATE photos SET uploader = ? WHERE uploader = ?", [
      newUsername,
      oldUsername,
    ]);

    const [updatedUserRows] = await pool.query(
      "SELECT id, username, profilePic FROM users WHERE username = ?",
      [newUsername]
    );
    res
      .status(200)
      .json({ message: "이름이 변경되었습니다.", user: updatedUserRows[0] });
  } catch (error) {
    res.status(500).json({ message: "이름 변경 실패" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
