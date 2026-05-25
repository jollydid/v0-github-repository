require("dotenv").config();
const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");
const warmupSteps = require("./warmup");

const { BOT_TOKEN, CHANNEL_ID } = process.env;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error("[bot] Missing env vars: BOT_TOKEN, CHANNEL_ID");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Хранилище активных прогревов
const activeWarmups = new Set();

// Отправка одного шага прогрева
async function sendStep(userId, step, telegram) {
  switch (step.type) {
    case "video_note": {
      // Кружок (видеосообщение)
      const filePath = path.resolve(__dirname, step.file);
      if (!fs.existsSync(filePath)) {
        console.error(`[bot] Video note file not found: ${filePath}`);
        return;
      }
      await telegram.sendChatAction(userId, "record_video_note");
      await telegram.sendVideoNote(userId, { source: filePath });
      break;
    }

    case "sticker": {
      // Стикер (в том числе премиум)
      await telegram.sendSticker(userId, step.file_id);
      break;
    }

    case "text":
    default: {
      // Текстовое сообщение
      await telegram.sendChatAction(userId, "typing");

      const options = {
        parse_mode: "HTML",
        disable_web_page_preview: false,
      };

      // Добавляем инлайн-кнопку если есть
      if (step.button) {
        options.reply_markup = {
          inline_keyboard: [
            [{ text: step.button.text, url: step.button.url }],
          ],
        };
      }

      await telegram.sendMessage(userId, step.text, options);
      break;
    }
  }
}

// Запуск прогрева
async function runWarmup(userId, telegram, { chatId, approveAfterFirst = false } = {}) {
  if (activeWarmups.has(userId)) {
    console.log(`[bot] User ${userId} already in warmup, skipping`);
    return;
  }

  activeWarmups.add(userId);
  console.log(`[bot] Starting warmup for user ${userId}`);

  try {
    for (let i = 0; i < warmupSteps.length; i++) {
      const step = warmupSteps[i];

      // Отправляем шаг
      await sendStep(userId, step, telegram);
      console.log(`[bot] Sent step ${i + 1}/${warmupSteps.length} (${step.type}) to user ${userId}`);

      // Одобряем заявку сразу после первого сообщения
      if (i === 0 && approveAfterFirst && chatId) {
        await approveJoinRequest(chatId, userId, telegram);
      }

      // Пауза после шага
      if (step.delay > 0) {
        console.log(`[bot] Waiting ${step.delay / 1000}s before next step...`);
        await new Promise((resolve) => setTimeout(resolve, step.delay));
      }
    }

    console.log(`[bot] Warmup completed for user ${userId}`);
  } catch (err) {
    console.error(`[bot] Warmup error for user ${userId}:`, err.message);
  } finally {
    activeWarmups.delete(userId);
  }
}

// Одобрение заявки на вступление
async function approveJoinRequest(chatId, userId, telegram) {
  try {
    await telegram.approveChatJoinRequest(chatId, userId);
    console.log(`[bot] Approved join request for user ${userId}`);
    return true;
  } catch (err) {
    console.error(`[bot] Failed to approve join request:`, err.message);
    return false;
  }
}

// Обработчик заявки на вступление в закрытый канал
bot.on("chat_join_request", async (ctx) => {
  const userId = ctx.chatJoinRequest.from.id;
  const chatId = ctx.chatJoinRequest.chat.id;
  const username = ctx.chatJoinRequest.from.username || "no_username";

  console.log(`[bot] Join request from user ${userId} (@${username}) for chat ${chatId}`);

  // Запускаем прогрев — заявка одобрится сразу после первого сообщения (кружка)
  runWarmup(userId, ctx.telegram, { chatId, approveAfterFirst: true });
});

// Для получения file_id стикера — отправь стикер боту
bot.on("sticker", (ctx) => {
  const sticker = ctx.message.sticker;
  console.log(`[bot] Received sticker:`, {
    file_id: sticker.file_id,
    emoji: sticker.emoji,
    set_name: sticker.set_name,
    is_premium: sticker.premium_animation ? true : false,
  });
  ctx.reply(`File ID стикера:\n<code>${sticker.file_id}</code>`, { parse_mode: "HTML" });
});

// /start
bot.start(async (ctx) => {
  console.log(`[bot] /start from ${ctx.from.id} (@${ctx.from.username})`);
  await ctx.reply(
    "Привет! Чтобы получить доступ к закрытому каналу, подай заявку на вступление. После этого я отправлю тебе важную информацию."
  );
});

// /help
bot.help((ctx) =>
  ctx.reply("Этот бот обрабатывает заявки на вступление в закрытый канал.\n\nПодай заявку — и я свяжусь с тобой!")
);

// Запуск
bot.launch().then(() => {
  console.log("[bot] Bot started, listening for chat_join_request events");
});

// Корректное завершение
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
