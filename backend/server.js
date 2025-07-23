const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 4000; // Render가 지정하는 포트를 사용하도록 설정

app.use(cors());
app.use(express.json());

// Render는 파일 시스템이 임시적이므로, 'uploads' 폴더를 동적으로 생성
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use("/uploads", express.static(uploadsDir));

const DB_PATH = path.join(__dirname, "db.json");

const readDB = () => {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], photos: [] }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(DB_PATH));
};

const writeDB = (data) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

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

// API 라우트들...
app.post("/api/signup", (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  if (db.users.find((u) => u.username === username)) {
    return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
  }
  const newUser = {
    username,
    password,
    profilePic: `https://placehold.co/192x192/EFEFEF/3A3A3A?text=${username.charAt(
      0
    )}`,
  };
  db.users.push(newUser);
  writeDB(db);
  res.status(201).json({ message: "회원가입 성공!" });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find(
    (u) => u.username === username && u.password === password
  );
  if (!user) {
    return res
      .status(401)
      .json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }
  const { password: _, ...userWithoutPassword } = user;
  res.status(200).json({ message: "로그인 성공!", user: userWithoutPassword });
});

app.post("/api/profile/upload", upload.single("profilePic"), (req, res) => {
  const { username } = req.body;
  if (!req.file) return res.status(400).json({ message: "파일이 없습니다." });
  const db = readDB();
  const userIndex = db.users.findIndex((u) => u.username === username);
  if (userIndex === -1)
    return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });

  const profilePicUrl = `/uploads/profilePic/${req.file.filename}`;
  db.users[userIndex].profilePic = profilePicUrl;
  writeDB(db);
  res
    .status(200)
    .json({ message: "프로필 사진이 업데이트되었습니다.", profilePicUrl });
});

app.post("/api/photos/upload", upload.single("photo"), (req, res) => {
  const { uploader, title, tags, description } = req.body;
  if (!req.file)
    return res.status(400).json({ message: "사진 파일이 필요합니다." });
  const db = readDB();
  const newPhoto = {
    id: Date.now(),
    uploader,
    url: `/uploads/photo/${req.file.filename}`,
    title,
    tags: tags ? tags.split(",").map((t) => t.trim()) : [],
    description,
    likes: [],
  };
  db.photos.unshift(newPhoto);
  writeDB(db);
  res
    .status(201)
    .json({ message: "사진이 업로드되었습니다.", photo: newPhoto });
});

app.get("/api/photos", (req, res) => {
  res.status(200).json(readDB().photos);
});

app.post("/api/photos/like", (req, res) => {
  const { photoId, username } = req.body;
  const db = readDB();
  const photo = db.photos.find((p) => p.id === photoId);
  if (!photo)
    return res.status(404).json({ message: "사진을 찾을 수 없습니다." });

  photo.likes = photo.likes || [];
  const likeIndex = photo.likes.indexOf(username);
  if (likeIndex > -1) {
    photo.likes.splice(likeIndex, 1);
  } else {
    photo.likes.push(username);
  }
  writeDB(db);
  res.status(200).json(photo);
});

app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
