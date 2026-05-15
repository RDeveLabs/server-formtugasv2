// app.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import "dotenv/config";
import { prisma } from "./connection.js";

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 50 * 1024 * 1024, // Max 50MB
  },
  fileFilter: (req, file, cb) => {
    // Hanya terima file PDF, tolak yang lain
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Hanya file PDF yang diterima"));
    }
    cb(null, true); // null = tidak ada error, true = terima file
  },
});

const app = express();

function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-rdl"];

  if (!apiKey) return res.status(401).send("token tidak ditemukan");

  if (apiKey !== process.env.RDL_API_KEY)
    return res.status(403).send("token tidak valid");

  return next();
}

async function compressWithLovePDF(filePath, originalName, kelas) {
  const PUBLIC_KEY = process.env.LOVEPDF_PUBLIC_KEY;

  // ── Step 1: Autentikasi ke LovePDF, dapat token JWT ──
  const authRes = await axios.post("https://api.ilovepdf.com/v1/auth", {
    public_key: PUBLIC_KEY,
  });
  const token = authRes.data.token;

  // Buat header Authorization sekali, pakai di semua request berikutnya
  const headers = { Authorization: `Bearer ${token}` };

  // ── Step 2: Start task, dapat server & task ID ──
  const taskRes = await axios.get(
    "https://api.ilovepdf.com/v1/start/compress",
    { headers },
  );
  const server = taskRes.data.server;
  const taskId = taskRes.data.task;

  // ── Step 3: Upload file ke server LovePDF ──
  // FormData di Node.js sedikit beda dari browser
  // Harus pakai library "form-data" karena Node.js tidak punya FormData bawaan
  const formData = new FormData();
  formData.append("task", taskId);
  formData.append("file", fs.createReadStream(filePath), originalName);
  // createReadStream = baca file sedikit-sedikit (hemat memory, tidak load semua sekaligus)

  const uploadRes = await axios.post(
    `https://${server}/v1/upload`,
    formData,
    { headers: { ...headers, ...formData.getHeaders() } },
    // getHeaders() = tambah Content-Type multipart/form-data otomatis
  );
  const serverFilename = uploadRes.data.server_filename;

  // ── Step 4: Jalankan proses compress ──
  await axios.post(
    `https://${server}/v1/process`,
    {
      task: taskId,
      tool: "compress",
      compression_level: "recommended", // low / recommended / extreme
      files: [{ server_filename: serverFilename, filename: originalName }],
    },
    { headers },
  );

  // ── Step 5: Download hasil dan simpan ke folder results/ ──
  const output = `result/${kelas}`;
  fs.mkdirSync(output, { recursive: true }); // buat folder kalau belum ada

  const outputPath = `${output}/${originalName}`;
  const downloadRes = await axios.get(
    `https://${server}/v1/download/${taskId}`,
    {
      headers,
      responseType: "arraybuffer", // terima data mentah (binary), bukan teks
    },
  );

  fs.writeFileSync(outputPath, downloadRes.data);
  const ukuranFile = fs.statSync(outputPath);

  return ukuranFile;
}

app.use(
  cors({
    origin: ["https://form.rdevelabs.com", "https://rekap.rdevelabs.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-rdl"],
  }),
);

app.get("/", (req, res) => {
  res.json({ status: "Server jalan! kereennnn" });
});

app.post(
  "/compress",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "file tidak ditemukan" });
    }
    // console.log("file req : ", req);
    // console.log("file req file: ", req.file);
    console.log("file req nama: ", req.body.nama);
    console.log("file req nim: ", req.body.nim);
    console.log("file req kelas: ", req.body.kelas);
    console.log("file req dari pertemuan: ", req.body.dariPertemuan);
    console.log("file req sampai pertemuan: ", req.body.sampaiPertemuan);

    try {
      // compress dulu
      const hasilCompress = await compressWithLovePDF(
        req.file.path,
        req.file.originalname,
        req.body.kelas,
      );

      const fileBaru = await prisma.file.create({
        data: {
          nama: req.body.nama,
          ukuran_file: hasilCompress.size,
          id_kelas: Number(req.body.kelas),
          nim: Number(req.body.nim),
          dari_pertemuan: Number(req.body.dariPertemuan),
          sampai_pertemuan: Number(req.body.sampaiPertemuan),
        },
      });

      res.json({ status: "ok", file: fileBaru });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Gagal memproses file" });
      prisma.$disconnect();
    } finally {
      fs.unlink(req.file.path, () => {});
      prisma.$disconnect();
    }
  },
);

app.get("/data", authMiddleware, async (req, res) => {
  const file = await prisma.file.findMany({
    select: {
      id: true,
      nama: true,
      nim: true,
      kelas: {
        select: {
          kelas: true
        }
      },
      dari_pertemuan: true,
      sampai_pertemuan: true,
      ukuran: true,
      waktu: true,
    },
  });
  res.status(200).json({
    status: "ok",
    file: [{file}],
  });
});

console.log("Server on");
app.listen(3000);
