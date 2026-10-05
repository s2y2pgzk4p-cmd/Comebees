import { GoogleGenAI } from '@google/genai';
import TelegramBot from 'node-telegram-bot-api';

const bot = new TelegramBot(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ownerId = 8922009735;

const chatHistories = new Map();
const ownerInbox = [];
const customRules = new Map();

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: "Bot is running on Netlify!" };
  }

  try {
    const update = JSON.parse(event.body);
    const msg = update.message || update.edited_message;
    
    if (!msg) return { statusCode: 200, body: "OK" };

    const chatId = msg.chat.id;
    const senderId = msg.from.id;
    const senderName = msg.from.first_name || "User";
    const senderUsername = msg.from.username ? "@" + msg.from.username : "No username";
    const isOwner = (senderId === ownerId || msg.from.username === "khosroabc");
    const text = msg.text || msg.caption || "";

    // 1. Owner settings update command
    if (isOwner && text.toLowerCase().startsWith("set details:")) {
      const newDetails = text.replace(/^set details:\s*/i, "").trim();
      customRules.set(ownerId, newDetails);
      await bot.sendMessage(chatId, "✅ Master rules successfully updated!");
      return { statusCode: 200, body: "OK" };
    }

    // 2. Owner check inbox command
    if (isOwner && (text.toLowerCase().includes("do i have any messages") || text.toLowerCase().includes("check my messages"))) {
      if (ownerInbox.length === 0) {
        await bot.sendMessage(chatId, "📭 Your inbox is empty.");
      } else {
        let report = "📥 **Saved User Messages:**\n\n";
        ownerInbox.forEach((m, idx) => {
          report += `${idx + 1}. From: ${m.from} (${m.username})\nMessage: ${m.text}\n\n`;
        });
        await bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
      }
      return { statusCode: 200, body: "OK" };
    }

    // 3. Handle Images / Photos for AI Analysis
    let contents = [];
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      const base64Image = Buffer.from(arrayBuffer).toString("base64");

      contents.push({
        inlineData: { mimeType: "image/jpeg", data: base64Image }
      });
    }

    if (text) contents.push({ text: text });
    if (contents.length === 0) return { statusCode: 200, body: "OK" };

    // 4. Continuous Chat History Management
    if (!chatHistories.has(senderId)) chatHistories.set(senderId, []);
    let history = chatHistories.get(senderId);
    history.push({ role: 'user', parts: contents });
    if (history.length > 12) history.shift();

    const rules = customRules.get(ownerId) || "No special rules yet.";
    const systemInstruction = isOwner
      ? `You are Khosro's personal assistant. Rules: ${rules}`
      : `You are an assistant for Khosro's bot. Chat naturally. If a visitor wants to leave a message for Khosro, use the extraction tool silently. Rules: ${rules}`;

    // 5. Call Gemini API
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: history,
      config: {
        systemInstruction: systemInstruction,
        tools: [{
          functionDeclarations: [{
            name: "extract_and_forward_message",
            description: "Extract visitor message intended for Khosro",
            parameters: {
              type: "OBJECT",
              properties: { extracted_message: { type: "STRING" } },
              required: ["extracted_message"]
            }
          }]
        }]
      }
    });

    const functionCalls = aiResponse.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "extract_and_forward_message") {
        const extractedText = call.args.extracted_message || text;
        ownerInbox.push({ from: senderName, username: senderUsername, text: extractedText, time: new Date() });
        await bot.sendMessage(ownerId, `🚨 **New Message for You (Khosro)!**\nFrom: ${senderName} (${senderUsername})\nMessage: ${extractedText}`, { parse_mode: "Markdown" });
      }
    }

    const replyText = aiResponse.text || "(No response text)";
    history.push({ role: 'model', parts: [{ text: replyText }] });

    await bot.sendMessage(chatId, replyText);
    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.toString() };
  }
}
