const axios = require("axios");

/* ================= CONFIG ================= */

module.exports.config = {
  name: "quizzid",
  version: "1.0.1",
  author: "Merdi Madimba",
  role: 2,
  category: "game",
  shortDescription: { fr: "Quizz image manga" },
  longDescription: { fr: "Quizz image manga avec images et vérification Gemini" },
  guide: { fr: "quizzid" },
  dependencies: { axios: "" }
};

/* ================= CONSTANTES ================= */

const ADMIN_UID = "100065927401614";
const JIKAN = "https://api.jikan.moe/v4";

const GEMINI_KEYS = [
  "AIzaSyBFrL8G8AxErKikGqUEGiMXnf4ntBc5hDo",
  "AIzaSyCiBWeok8eWxq2C2dKWGgwyS-tHSoyEJ4M",
  "AIzaSyAqzuy7IvpOgJvkm_hSQswwNNqHkBFeSZA",
  "AIzaSyAMiBew_-GeFe7z2ESh6yU9Eu9ZOq8Kjy8",
  "AIzaSyDb1gOcJTcVTtMvfJxPKB5aC0spLD9p0Js",
  "AIzaSyCIKInvO4gipyraTm8pP3qkCxMULH9_uOg"
];

let keyIndex = 0;
const nextKey = () => {
  const key = GEMINI_KEYS[keyIndex];
  keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;
  return key;
};

/* ================= SESSION ================= */

let session = null;

/* ================= GEMINI ================= */

async function geminiCheck(answer, correct) {
  const prompt = `Réponds uniquement par OUI ou NON.\n"${answer}" correspond-il au personnage "${correct}" ?`;

  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      const res = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        { contents: [{ parts: [{ text: prompt }] }] },
        { params: { key: nextKey() } }
      );

      const text =
        res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (text.trim().toUpperCase() === "OUI") return true;
    } catch {}
  }
  return false;
}

/* ================= JIKAN ================= */

async function getCharacters(manga, limit) {
  try {
    let url = `${JIKAN}/characters`;

    if (manga !== "MULTIVERSE") {
      const search = await axios.get(`${JIKAN}/manga`, {
        params: { q: manga, limit: 1 }
      });
      if (!search.data.data.length) return [];
      url = `${JIKAN}/manga/${search.data.data[0].mal_id}/characters`;
    }

    const res = await axios.get(url);

    return res.data.data
      .filter(c => c.character?.images?.jpg?.image_url)
      .sort(() => Math.random() - 0.5)
      .slice(0, limit)
      .map(c => ({
        name: c.character.name,
        image: c.character.images.jpg.image_url
      }));
  } catch {
    return [];
  }
}

/* ================= START ================= */

module.exports.onStart = async ({ api, event }) => {
  if (!event.isGroup) return;
  if (event.senderID !== ADMIN_UID) return;

  session = {
    step: 1,
    threadID: event.threadID,
    admin: event.senderID,
    images: [],
    index: 0,
    scores: {},
    timer: null,
    lock: false
  };

  api.sendMessage(
    "📘 Entrez le nom du manga (ou MULTIVERSE)",
    event.threadID
  );
};

/* ================= CHAT ================= */

module.exports.onChat = async ({ api, event }) => {
  if (!session) return;
  if (event.threadID !== session.threadID) return;

  /* Étape 1 : manga */
  if (session.step === 1 && event.senderID === session.admin) {
    session.manga = event.body.trim();
    session.step = 2;
    return api.sendMessage("🖼️ Combien d’images ?", session.threadID);
  }

  /* Étape 2 : nombre */
  if (session.step === 2 && event.senderID === session.admin) {
    const n = parseInt(event.body);
    if (!n || n <= 0) return;

    session.images = await getCharacters(session.manga, n);

    if (!session.images.length) {
      session = null;
      return api.sendMessage("❌ Aucun personnage trouvé.", event.threadID);
    }

    session.step = 3;
    return sendImage(api);
  }

  /* Étape 3 : réponses */
  if (session.step === 3 && !session.lock) {
    const current = session.images[session.index];
    if (!current) return;

    const ok = await geminiCheck(event.body, current.name);
    if (!ok) return;

    session.lock = true;
    clearTimeout(session.timer);

    session.scores[event.senderID] =
      (session.scores[event.senderID] || 0) + 10;

    api.setMessageReaction("👍", event.messageID, () => {}, true);

    sendScores(api);

    session.index++;
    session.lock = false;

    if (session.index >= session.images.length) return endQuiz(api);
    sendImage(api);
  }
};

/* ================= IMAGE ================= */

async function sendImage(api) {
  const current = session.images[session.index];
  if (!current) return endQuiz(api);

  api.sendMessage(
    {
      attachment: await axios
        .get(current.image, { responseType: "stream" })
        .then(r => r.data)
    },
    session.threadID
  );

  session.timer = setTimeout(() => {
    api.sendMessage(`⏱️ Temps écoulé\n✅ Réponse : ${current.name}`, session.threadID);
    session.index++;
    session.index >= session.images.length
      ? endQuiz(api)
      : sendImage(api);
  }, 10000);
}

/* ================= SCORES ================= */

function sendScores(api) {
  let msg = "🏆 SCORES\n\n";
  const mentions = [];

  for (const uid in session.scores) {
    mentions.push({ id: uid, tag: `@${uid}` });
    msg += `@${uid} : ${session.scores[uid]} pts\n`;
  }

  api.sendMessage({ body: msg, mentions }, session.threadID);
}

/* ================= FIN ================= */

function endQuiz(api) {
  clearTimeout(session.timer);

  let winner = null;
  let max = 0;

  for (const uid in session.scores) {
    if (session.scores[uid] > max) {
      max = session.scores[uid];
      winner = uid;
    }
  }

  let msg = "🏁 QUIZZ TERMINÉ\n\n";
  const mentions = [];

  for (const uid in session.scores) {
    mentions.push({ id: uid, tag: `@${uid}` });
    msg += `@${uid} : ${session.scores[uid]} pts\n`;
  }

  if (winner) {
    mentions.push({ id: winner, tag: `@${winner}` });
    msg += `\n🥇 GAGNANT : @${winner}`;
  }

  api.sendMessage({ body: msg, mentions }, session.threadID);
  session = null;
        }
