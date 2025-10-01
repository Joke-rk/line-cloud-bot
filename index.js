// โหลด environment variables (.env) เข้ามาใช้ เช่น TOKEN, SECRET
require("dotenv").config();

const express = require("express");         // ใช้สร้าง Web Server
const bodyParser = require("body-parser");  // ใช้แปลง JSON ที่ส่งเข้ามา
const axios = require("axios");             // ใช้เรียก API ภายนอก
const line = require("@line/bot-sdk");      // SDK สำหรับเชื่อมต่อกับ LINE Messaging API
const tf = require("@tensorflow/tfjs-node"); // ใช้ TensorFlow.js สำหรับ Node (มี decodeImage)
const path = require("path");               // จัดการ path ของไฟล์

const app = express();
app.use(bodyParser.json()); // ให้ server อ่าน body JSON ได้

// ---------------------------
// 1) ตั้งค่า LINE Messaging API จาก ENV
// ---------------------------
console.log("🔑 Access Token length:", process.env.LINE_CHANNEL_ACCESS_TOKEN?.length);
console.log("🔑 Secret length:", process.env.LINE_CHANNEL_SECRET?.length);
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN, // token สำหรับยิง API LINE
  channelSecret: process.env.LINE_CHANNEL_SECRET,            // secret สำหรับตรวจสอบความถูกต้อง
};
const client = new line.Client(config); // client object สำหรับส่งข้อความกลับไปที่ LINE

// ---------------------------
// 2) โหลดโมเดล Teachable Machine ที่เรา train ไว้
// ---------------------------
const metadata = require("./models/metadata.json"); // อ่านไฟล์ metadata (มี labels)
const labels = metadata.labels; // เก็บ label ที่ train ไว้ เช่น ชนิดของเมฆ

let model;
(async () => {
  try {
    const modelPath = "file://" + path.join(__dirname, "models/model.json"); // ระบุ path ของ model
    model = await tf.loadLayersModel(modelPath); // โหลดโมเดลจากไฟล์
    console.log("✅ Cloud model loaded!");
  } catch (err) {
    console.error("❌ Error loading model:", err);
  }
})();

// ---------------------------
// 3) Webhook Endpoint
// ---------------------------
// Endpoint ที่ LINE จะส่ง event เข้ามา
app.post("/webhook", (req, res) => {
  console.log("📩 Webhook event received:", JSON.stringify(req.body, null, 2));
  res.status(200).end(); // ต้องตอบกลับ 200 ให้ LINE ทันที

  // loop handle event ที่ส่งมา
  Promise.all(req.body.events.map(handleEvent))
    .catch((err) => console.error("handleEvent error:", err));
});

// endpoint สำหรับทดสอบว่าเซิร์ฟเวอร์รันอยู่
app.get("/webhook", (req, res) => {
  res.status(200).send("Webhook is running 🚀");
});

// ---------------------------
// 4) ฟังก์ชันจัดการ Event ที่ส่งมาจาก LINE
// ---------------------------
async function handleEvent(event) {
  // ถ้า user ส่งรูปภาพมา → เรียก classifyCloud
  if (event.type === "message" && event.message.type === "image") {
    return classifyCloud(event);
  }

  // ถ้าไม่ใช่รูปภาพ → ตอบกลับเป็นข้อความปกติ
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "กรุณาส่งรูปเมฆมาให้ฉันวิเคราะห์ได้เลยค่ะ 🌤️",
  });
}

// ---------------------------
// 5) ฟังก์ชันวิเคราะห์เมฆจากภาพ
// ---------------------------
async function classifyCloud(event) {
  try {
    if (!model) {
      // ถ้าโมเดลยังโหลดไม่เสร็จ
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "⏳ กำลังโหลดโมเดลอยู่ กรุณาลองใหม่อีกครั้งภายหลัง",
      });
    }

    // 5.1 ดึงไฟล์ภาพจาก LINE API (ใช้ messageId ที่ user ส่งมา)
    const url = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${config.channelAccessToken}` },
    });

    // 5.2 แปลง binary → Tensor (เพื่อป้อนเข้าโมเดล)
    const imageTensor = tf.node.decodeImage(response.data, 3)  // decode เป็น RGB
      .resizeNearestNeighbor([224, 224]) // ปรับขนาดเป็น 224x224
      .expandDims(0)                     // เพิ่ม batch dimension
      .toFloat()
      .div(tf.scalar(255.0));            // ทำ normalization ค่า [0-1]

    // 5.3 Predict ด้วยโมเดล
    const predictions = model.predict(imageTensor);
    const probs = predictions.dataSync(); // ได้ค่าเป็น array ของความน่าจะเป็น
    const bestIdx = probs.indexOf(Math.max(...probs)); // หาตัวที่มี % สูงสุด
    const bestLabel = labels[bestIdx];                 // หาว่าเป็น label อะไร
    const bestProb = (probs[bestIdx] * 100).toFixed(2); // แปลงเป็น %

    // log ข้อมูล prediction ทั้งหมด
    console.log("🔍 Prediction:", labels.map((l, i) => `${l}: ${(probs[i] * 100).toFixed(2)}%`).join(", "));

    // 5.4 ส่งข้อความตอบกลับผู้ใช้
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `☁️ เมฆที่ตรวจพบคือ: ${bestLabel} (${bestProb}%)`,
    });

  } catch (err) {
    console.error("❌ Error while classifying cloud:", err);
    // ถ้า error ให้ตอบข้อความแจ้งผู้ใช้
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "เกิดข้อผิดพลาดในการวิเคราะห์รูปเมฆ ❌",
    });
  }
}

// ---------------------------
// 6) Start Server
// ---------------------------
const PORT = process.env.PORT || 3000; // ใช้ port จาก ENV หรือ 3000
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
