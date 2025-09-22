// เรียกใช้ library ที่จำเป็น
const express = require("express");       // ใช้สร้าง Web Server
const bodyParser = require("body-parser"); // ใช้อ่านข้อมูล JSON ที่ส่งเข้ามา
const axios = require("axios");            // ใช้สำหรับเรียก API ภายนอก (HTTP Request)
const line = require("@line/bot-sdk");     // LINE Messaging API SDK

const app = express();     
app.use(bodyParser.json()); // กำหนดให้ server อ่าน JSON ได้

// ---- ตั้งค่า LINE Messaging API ----
const config = {
  channelAccessToken: "8Ji7VFCdF/g5/bujK+g02zPKvBQW9C7WhMpzaSbPIV+x97Ecf7ik1fT0G3j6ynUkYXRhhe5MXQpDIKYGgQ5Z17kceLo3lAKOMUDsYlKo4BgMpNbjRYLSR59Z1mBtFo8Lflw3cwlK9crqOlGBxuCfTwdB04t89/1O/w1cDnyilFU=", // <<< Access Token ที่คุณ copy มา
  channelSecret: "fba78e207ea5dd97bdcf3030a840a52f" // <<< Channel Secret
};
const client = new line.Client(config); // สร้าง client สำหรับคุยกับ LINE API

// ---- กำหนด Webhook Endpoint ----
app.post("/webhook", (req, res) => {
  // ดักทุก event ที่ส่งมาจาก LINE → ส่งไปที่ handleEvent()
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ---- ฟังก์ชันหลักสำหรับจัดการ Event ----
async function handleEvent(event) {
  // เช็คว่าข้อความที่ส่งมาคือ "รูปภาพ" หรือไม่
  if (event.type === "message" && event.message.type === "image") {
    
    // 1) ดึงไฟล์รูปภาพจาก LINE API
    const url = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
    const response = await axios.get(url, {
      responseType: "arraybuffer", // โหลดรูปมาเป็น Binary
      headers: { Authorization: `Bearer ${config.channelAccessToken}` } // ใส่ token เพื่อยืนยันสิทธิ์
    });

    // แปลงรูปภาพเป็น base64 (เตรียมไว้ส่งให้ Teachable Machine)
    const imageBase64 = Buffer.from(response.data, "binary").toString("base64");

    // 2) URL ของโมเดล Teachable Machine
    const tmUrl = "https://teachablemachine.withgoogle.com/models/wiosdb8Tx/";
    const predictUrl = `${tmUrl}image`; // endpoint สำหรับส่งรูปไปทำนาย

    // เตรียมข้อมูล (form-data) สำหรับส่งรูปไปที่ Teachable Machine
    const FormData = require("form-data");
    const formData = new FormData();
    formData.append("file", Buffer.from(imageBase64, "base64"), "upload.jpg");

    // 3) ส่งรูปไปให้ Teachable Machine วิเคราะห์
    const predictRes = await axios.post(predictUrl, formData, {
      headers: formData.getHeaders()
    });

    // ได้ผลลัพธ์การทำนาย (list ของ label + ความน่าจะเป็น)
    const predictions = predictRes.data;

    // หา label ที่มีค่าความน่าจะเป็น (probability) มากที่สุด
    const best = predictions.reduce((a, b) =>
      a.probability > b.probability ? a : b
    );

    // 4) ส่งข้อความตอบกลับไปยังผู้ใช้ใน LINE
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `เมฆที่น่าจะใช่มากที่สุด: ${best.className} (${(best.probability * 100).toFixed(2)}%)`
    });
  }

  // ถ้าไม่ได้ส่งรูป → ตอบข้อความแนะนำกลับไป
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "ลองส่งรูปเมฆมาให้ฉันดู 🌤️"
  });
}

// ---- Start Server ----
const PORT = process.env.PORT || 3000; // ใช้ port 3000 หรือ port จาก environment (กรณี deploy)
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
