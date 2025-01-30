require("dotenv").config();
const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS
  ? process.env.TELEGRAM_CHAT_IDS.split(",")
  : [];
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const URL_TO_CHECK = process.env.URL_TO_CHECK;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL || 20000; // Default: 20 sec
const MAX_RETRIES = 3; // Number of retry attempts for failed requests
const SMS_API_KEY = process.env.SMS_API_KEY;
const SMS_LINE_NUMBER = process.env.SMS_LINE_NUMBER;
const SMS_PHONE_NUMBERS = process.env.SMS_PHONE_NUMBERS
  ? process.env.SMS_PHONE_NUMBERS.split(",")
  : [];

const PROXY_TYPE = process.env.PROXY_TYPE;
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

let proxyAgent = null;

// Configure proxy agent
if (PROXY_TYPE && PROXY_HOST && PROXY_PORT) {
  const proxyUrl = `${PROXY_TYPE}://${
    PROXY_USERNAME ? `${PROXY_USERNAME}:${PROXY_PASSWORD}@` : ""
  }${PROXY_HOST}:${PROXY_PORT}`;

  if (PROXY_TYPE.startsWith("socks")) {
    proxyAgent = new SocksProxyAgent(proxyUrl);
  } else if (PROXY_TYPE.startsWith("http")) {
    proxyAgent = new HttpsProxyAgent(proxyUrl);
  }

  console.info(
    `🌐 Using ${PROXY_TYPE.toUpperCase()} Proxy: ${PROXY_HOST}:${PROXY_PORT}`
  );
}

if (
  !TELEGRAM_BOT_TOKEN ||
  TELEGRAM_CHAT_IDS.length === 0 ||
  !URL_TO_CHECK ||
  !SLACK_WEBHOOK_URL
) {
  console.error("❌ Missing required environment variables in .env file!");
  process.exit(1);
}

// Reusable Axios instance with timeout
const http = axios.create({ timeout: 5000 });

// Axios instance with proxy support
const httpViaProxy = axios.create({
  timeout: 5000,
  proxy: false, // Disable default proxy handling
  httpsAgent: proxyAgent,
});

// Cache to track website status (prevents redundant alerts)
let lastStatus = 200;

async function checkWebsite(retries = 0) {
  try {
    const response = await http.get(URL_TO_CHECK);
    if (response.status === 200) {
      console.log({
        data: response.data,
        status: response.status,
      });
      if (lastStatus !== 200) {
        console.info(`✅ Website is back online: ${URL_TO_CHECK}`);
        await sendNotification(`✅ Website is back online: ${URL_TO_CHECK}`);
      }
      lastStatus = 200;
    } else {
      if (lastStatus !== response.status) {
        console.warn(`⚠️ Website down! Status: ${response.status}`);
        await sendNotification(`⚠️ Website down! Status: ${response.status}`);
      }
      lastStatus = response.status;
    }
  } catch (error) {
    if (retries < MAX_RETRIES) {
      console.warn(
        `🔁 Retry ${
          retries + 1
        }/${MAX_RETRIES}: Checking ${URL_TO_CHECK} again...`
      );
      return checkWebsite(retries + 1);
    }
    if (lastStatus !== "DOWN") {
      console.error(`🚨 Error accessing the website: ${error.message}`);
      await sendNotification(
        `🚨 Error accessing the website: ${error.message}`
      );
    }
    lastStatus = "DOWN";
  }
}

// Unified function to send notifications
async function sendNotification(message) {
  await Promise.all([
    sendTelegramMessage(message),
    sendSlackMessage(message),
    sendSmsMessage(message),
  ]);
}

// Send message to multiple Telegram users in parallel
async function sendTelegramMessage(message) {
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    await Promise.all(
      TELEGRAM_CHAT_IDS.map((chatId) =>
        httpViaProxy.post(telegramApiUrl, {
          chat_id: chatId.trim(),
          text: message,
        })
      )
    );
    console.info("📨 Telegram notification sent.");
  } catch (error) {
    console.error("⚠️ Failed to send Telegram message:", error.message);
    console.error(error.response.data);
    console.error(error);
  }
}

async function sendSmsMessage(message) {
  try {
    http.post(
      "https://api.sms.ir/v1/send/bulk",
      {
        lineNumber: SMS_LINE_NUMBER,
        MessageText: message,
        Mobiles: SMS_PHONE_NUMBERS,
      },
      {
        headers: {
          "X-API-KEY": SMS_API_KEY,
          ACCEPT: "application/json",
          "Content-Type": "application/json",
        },
      }
    );
    console.info("📨 Sms message sent.");
  } catch (error) {
    console.error("⚠️ Failed to send Sms message:", error.message);
  }
}

// Send Slack message
async function sendSlackMessage(message) {
  try {
    await http.post(SLACK_WEBHOOK_URL, { text: message });
    console.info("📨 Slack notification sent.");
  } catch (error) {
    console.error("⚠️ Failed to send Slack message:", error.message);
  }
}

// Run check every X seconds
setInterval(checkWebsite, CHECK_INTERVAL);
console.log(
  `🚀 Monitoring ${URL_TO_CHECK} every ${CHECK_INTERVAL / 1000} seconds...`
);

sendNotification("🚀 Starting website monitoring...");
