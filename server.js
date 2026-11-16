"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { networkInterfaces } = require("node:os");
const { randomBytes } = require("node:crypto");
const { MultiplayerTable } = require("./multiplayer.js");

const rooms = new Map();
const capacity = 16;
const turnDuration = 45_000;
const port = Number(process.env.POKER_PORT || process.env.PORT || 8766);
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/poker.js", ["poker.js", "text/javascript"]],
  ["/rooms.js", ["rooms.js", "text/javascript"]]
]);

function reply(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function advanceRoom(room, now = Date.now()) {
  room.revision++;
  room.deadline = room.game.done ? null : now + turnDuration;
}

function expireTurn(room, now) {
  if (!room.deadline || now < room.deadline) return;
  const game = room.game;
  const seat = game.turn;
  const action = game.options(seat).call ? "fold" : "pass";
  game.act(seat, action, undefined, true);
  advanceRoom(room, now);
}

function roomState(room, seat) {
  const game = room.game;
  return {
    code: room.code, seat, revision: room.revision, serverTime: Date.now(),
    names: room.players.map(player => player.name),
    game: game && {
      number: game.number, dealer: game.dealer, stacks: game.stacks, board: game.board,
      street: game.street, pot: game.pot, turn: game.turn, done: game.done, result: game.result,
      history: game.history, deadline: room.deadline,
      cards: game.hole.map((cards, index) => (
        index === seat || (game.reveal && !game.folded.has(index)) ? cards : cards.map(() => null)
      )),
      folded: [...game.folded],
      options: game.turn === seat ? game.options(seat) : null,
      matchOver: game.stacks.filter(Boolean).length < 2
    }
  };
}

async function bodyOf(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("需要 JSON 请求");
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 2048) throw new Error("请求过大");
  }
  return JSON.parse(data);
}

function addPlayer(room, requestedName) {
  const seat = room.players.length;
  const base = String(requestedName || "").trim().slice(0, 16) || "玩家 " + (seat + 1);
  const name = room.players.some(player => player.name === base) ? base + " #" + (seat + 1) : base;
  const token = randomBytes(24).toString("hex");
  room.players.push({ name, token });
  room.revision++;
  room.touched = Date.now();
  return { code: room.code, token, state: roomState(room, seat) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const asset = assets.get(url.pathname);
  if (req.method === "GET" && asset) {
    res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(fs.readFileSync(path.join(__dirname, "dist", asset[0])));
    return;
  }
  try {
    const data = req.method === "POST" ? await bodyOf(req) : {};
    if (req.method === "POST" && url.pathname === "/api/create") {
      if (rooms.size >= 200) return reply(res, 503, { error: "房间已满，请稍后重试。" });
      let code;
      do { code = randomBytes(4).toString("hex").toUpperCase(); } while (rooms.has(code));
      const room = { code, players: [], revision: 0, touched: Date.now(), game: null };
      rooms.set(code, room);
      return reply(res, 201, addPlayer(room, data.name));
    }
    const room = rooms.get(String(data.code || url.searchParams.get("code") || "").toUpperCase());
    if (!room) return reply(res, 404, { error: "房间不存在或已过期。" });
    if (req.method === "POST" && url.pathname === "/api/join") {
      if (room.game) return reply(res, 409, { error: "房间已开局。请让房主创建新房间。" });
      if (room.players.length >= capacity) return reply(res, 409, { error: "房间已满（16 人）。" });
      return reply(res, 200, addPlayer(room, data.name));
    }
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const seat = room.players.findIndex(player => player.token === token);
    if (seat < 0) return reply(res, 401, { error: "座位验证失败。" });
    room.touched = Date.now();
    expireTurn(room, room.touched);
    if (req.method === "GET" && url.pathname === "/api/state") return reply(res, 200, roomState(room, seat));
    if (req.method !== "POST" || url.pathname !== "/api/action") return reply(res, 404, { error: "入口不存在。" });
    if (data.revision !== room.revision) return reply(res, 409, { error: "牌桌已更新，请重试。" });
    if (data.action === "start") {
      if (seat !== 0 || room.game || room.players.length < 2) return reply(res, 409, { error: "至少两人到齐后由房主开局。" });
      room.game = new MultiplayerTable(room.players.map(player => player.name));
    } else if (data.action === "next") {
      if (seat !== 0 || !room.game?.done || !room.game.start()) return reply(res, 409, { error: "本手结束后由房主发下一手。" });
    } else if (!room.game?.act(seat, data.action, data.target)) {
      return reply(res, 409, { error: "当前无法执行该操作，请检查轮次和金额。" });
    }
    advanceRoom(room);
    return reply(res, 200, roomState(room, seat));
  } catch {
    return reply(res, 400, { error: "请求格式有误。" });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) expireTurn(room, now);
}, 250).unref();

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff) rooms.delete(code);
}, 60000).unref();

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    const actual = server.address().port;
    console.log("游戏服务已启动，端口 " + actual);
    if (process.env.RENDER) return;
    console.log("本机打开 http://localhost:" + actual);
    for (const interfaces of Object.values(networkInterfaces())) {
      for (const entry of interfaces) {
        if (!entry.internal && entry.family === "IPv4") console.log("同一网络玩家打开 http://" + entry.address + ":" + actual);
      }
    }
  });
}

module.exports = { server };
