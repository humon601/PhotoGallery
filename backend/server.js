const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 4000;

// --- 미들웨어 설정 ---
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use("/uploads", express.static(uploadsDir));

// --- MongoDB 연결 ---
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "photoGallery";
const client = new MongoClient(uri);

let db;
async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log("✅ MongoDB에 성공적으로 연결되었습니다.");
  } catch (error) {
    console.error("MongoDB 연결 실패:", error);
    process.exit(1);
  }
}
connectDB();

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
    const usersCollection = db.collection("users");
    const existingUser = await usersCollection.findOne({ username });

    if (existingUser) {
      return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
    }
    const newUser = {
      username,
      password, // 실제로는 bcrypt 등으로 해싱해야 합니다.
      question,
      answer,
      profilePic: `https://placehold.co/192x192/EFEFEF/3A3A3A?text=${username.charAt(
        0
      )}`,
    };
    await usersCollection.insertOne(newUser);
    res.status(201).json({ message: "회원가입 성공!" });
  } catch (error) {
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 로그인
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection("users").findOne({ username, password });
    if (!user) {
      const userExists = await db.collection("users").findOne({ username });
      if (userExists) {
        return res
          .status(401)
          .json({
            needsRecovery: true,
            question: userExists.question,
            message: "비밀번호가 틀렸습니다.",
          });
      }
      return res
        .status(401)
        .json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const { password: _, question, answer, ...userWithoutSensitiveData } = user;
    res
      .status(200)
      .json({ message: "로그인 성공!", user: userWithoutSensitiveData });
  } catch (error) {
    res.status(500).json({ message: "서버 오류" });
  }
});

// 비밀번호 찾기 (질문/답변 확인)
app.post("/api/login/recover", async (req, res) => {
  try {
    const { username, answer } = req.body;
    const user = await db.collection("users").findOne({ username, answer });
    if (!user) {
      return res.status(401).json({ message: "답변이 올바르지 않습니다." });
    }
    const {
      password: _,
      question,
      answer: ans,
      ...userWithoutSensitiveData
    } = user;
    res
      .status(200)
      .json({ message: "로그인 성공!", user: userWithoutSensitiveData });
  } catch (error) {
    res.status(500).json({ message: "서버 오류" });
  }
});

// 모든 사진 가져오기
app.get("/api/photos", async (req, res) => {
  try {
    const photos = await db
      .collection("photos")
      .find()
      .sort({ _id: -1 })
      .toArray();
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
    const newPhoto = {
      uploader,
      url: `/uploads/photo/${req.file.filename}`,
      title,
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
      description,
      likes: [],
    };
    const result = await db.collection("photos").insertOne(newPhoto);
    res
      .status(201)
      .json({
        message: "사진이 업로드되었습니다.",
        photo: { ...newPhoto, _id: result.insertedId },
      });
  } catch (error) {
    res.status(500).json({ message: "업로드 실패" });
  }
});

// 사진 공감
app.post("/api/photos/like", async (req, res) => {
  try {
    const { photoId, username } = req.body;
    const photo = await db
      .collection("photos")
      .findOne({ _id: new ObjectId(photoId) });
    if (!photo)
      return res.status(404).json({ message: "사진을 찾을 수 없습니다." });

    const likes = photo.likes || [];
    const likeIndex = likes.indexOf(username);
    if (likeIndex > -1) {
      likes.splice(likeIndex, 1);
    } else {
      likes.push(username);
    }
    await db
      .collection("photos")
      .updateOne({ _id: new ObjectId(photoId) }, { $set: { likes } });
    res.status(200).json({ likes });
  } catch (error) {
    res.status(500).json({ message: "처리 실패" });
  }
});

// 사진 삭제
app.delete("/api/photos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("photos").deleteOne({ _id: new ObjectId(id) });
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
    await db
      .collection("photos")
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            tags: tags ? tags.split(",").map((t) => t.trim()) : [],
            description,
          },
        }
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
    const user = await db.collection("users").findOne({ username });
    if (!user)
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    const { password, question, answer, ...publicProfile } = user;
    res.status(200).json(publicProfile);
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
      await db
        .collection("users")
        .updateOne({ username }, { $set: { profilePic: profilePicUrl } });
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

    const existingUser = await db
      .collection("users")
      .findOne({ username: newUsername });
    if (existingUser)
      return res.status(400).json({ message: "이미 사용 중인 이름입니다." });

    // 트랜잭션으로 묶어서 안정성 확보 (선택적)
    await db
      .collection("users")
      .updateOne(
        { username: oldUsername },
        { $set: { username: newUsername } }
      );
    await db
      .collection("photos")
      .updateMany(
        { uploader: oldUsername },
        { $set: { uploader: newUsername } }
      );
    await db
      .collection("photos")
      .updateMany({ likes: oldUsername }, { $pull: { likes: oldUsername } });
    await db
      .collection("photos")
      .updateMany({ likes: { $exists: false } }, { $set: { likes: [] } }); // likes 필드 없는 문서 초기화
    await db
      .collection("photos")
      .updateMany({ likes: newUsername }, { $push: { likes: newUsername } });

    const updatedUser = await db
      .collection("users")
      .findOne({ username: newUsername });
    const { password, ...userWithoutPassword } = updatedUser;
    res
      .status(200)
      .json({ message: "이름이 변경되었습니다.", user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ message: "이름 변경 실패" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
