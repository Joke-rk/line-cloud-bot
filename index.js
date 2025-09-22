// โหลด environment variables (.env)
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const line = require("@line/bot-sdk");
const tf = require("@tensorflow/tfjs-node");   // ใช้ tfjs-node (มี decodeImage)
const path = require("path");

const app = express();
app.use(bodyParser.json());

// ---------------------------
// 1) ตั้งค่า LINE Messaging API จาก ENV
// ---------------------------
console.log("🔑 Access Token length:", process.env.LINE_CHANNEL_ACCESS_TOKEN?.length);
console.log("🔑 Secret length:", process.env.LINE_CHANNEL_SECRET?.length);
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN, // token จาก LINE
  channelSecret: process.env.LINE_CHANNEL_SECRET,            // secret จาก LINE
};
const client = new line.Client(config); // client สำหรับตอบกลับไปที่ LINE

// ---------------------------
// 2) โหลดโมเดล Teachable Machine ที่เรา train ไว้
// ---------------------------
const metadata = require("./models/metadata.json");
const labels = metadata.labels;

let model;
(async () => {
  try {
    const modelPath = "file://" + path.join(__dirname, "models/model.json");
    model = await tf.loadLayersModel(modelPath);
    console.log("✅ Cloud model loaded!");
  } catch (err) {
    console.error("❌ Error loading model:", err);
  }
})();

// ---------------------------
// 3) Webhook Endpoint
// ---------------------------
app.post("/webhook", (req, res) => {
  console.log("📩 Webhook event received:", JSON.stringify(req.body, null, 2));
  res.status(200).end(); // ✅ ต้องตอบ 200 กลับทันที

  Promise.all(req.body.events.map(handleEvent))
    .catch((err) => console.error("handleEvent error:", err));
});

app.get("/webhook", (req, res) => {
  res.status(200).send("Webhook is running 🚀");
});

// ---------------------------
// 4) ฟังก์ชันจัดการ Event
// ---------------------------
async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "image") {
    return classifyCloud(event);
  }

  // กรณีข้อความธรรมดา
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "ส่งรูปเมฆมาให้ฉันวิเคราะห์สิ 🌤️",
  });
}

// ---------------------------
// 5) ฟังก์ชันวิเคราะห์เมฆ
// ---------------------------
async function classifyCloud(event) {
  try {
    if (!model) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "⏳ กำลังโหลดโมเดลอยู่ กรุณาลองใหม่อีกครั้งภายหลัง",
      });
    }

    // 5.1 ดึงไฟล์ภาพจาก LINE API
    const url = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${config.channelAccessToken}` },
    });

    // 5.2 แปลง binary → Tensor
    const imageTensor = tf.node.decodeImage(response.data, 3)
      .resizeNearestNeighbor([224, 224])
      .expandDims(0)
      .toFloat()
      .div(tf.scalar(255.0));

    // 5.3 Predict
    const predictions = model.predict(imageTensor);
    const probs = predictions.dataSync();
    const bestIdx = probs.indexOf(Math.max(...probs));
    const bestLabel = labels[bestIdx];
    const bestProb = (probs[bestIdx] * 100).toFixed(2);

    console.log("🔍 Prediction:", labels.map((l, i) => `${l}: ${(probs[i] * 100).toFixed(2)}%`).join(", "));

    // 5.4 ตอบกลับ
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `☁️ เมฆที่ตรวจพบคือ: ${bestLabel} (${bestProb}%)`,
    });

  } catch (err) {
    console.error("❌ Error while classifying cloud:", err);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "เกิดข้อผิดพลาดในการวิเคราะห์รูปเมฆ ❌",
    });
  }
}

// ---------------------------
// 6) Start Server
// ---------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
