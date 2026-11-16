"use strict";

const { randomInt } = require("node:crypto");
const { bestHand, compare, handNames, streets, suits, ranks, bigBlind } = require("./dist/poker.js");

class MultiplayerTable {
  constructor(names) {
    this.names = names.slice();
    this.stacks = names.map(() => 1000);
    this.number = 0;
    this.dealer = -1;
    this.history = [];
    this.start();
  }

  nextAfter(index, choices) {
    for (let offset = 1; offset <= this.names.length; offset++) {
      const seat = (index + offset) % this.names.length;
      if (choices.has(seat)) return seat;
    }
    return null;
  }

  start() {
    const live = new Set(this.stacks.flatMap((stack, seat) => stack ? [seat] : []));
    if (live.size < 2) return false;
    this.number++;
    this.dealer = this.nextAfter(this.dealer, live);
    this.playing = live;
    this.folded = new Set();
    this.board = [];
    this.street = 0;
    this.done = false;
    this.reveal = false;
    this.result = "";
    this.pot = 0;
    this.total = this.names.map(() => 0);
    this.bets = this.names.map(() => 0);
    this.actedAt = this.names.map(() => null);
    this.minRaise = bigBlind;
    this.deck = suits.flatMap(suit => ranks.slice(2).map((_, index) => ({ rank: index + 2, suit })));
    for (let index = this.deck.length - 1; index > 0; index--) {
      const other = randomInt(index + 1);
      [this.deck[index], this.deck[other]] = [this.deck[other], this.deck[index]];
    }
    this.hole = this.names.map(() => []);
    for (let round = 0; round < 2; round++) {
      let seat = this.dealer;
      for (let count = 0; count < live.size; count++) {
        seat = this.nextAfter(seat, live);
        this.hole[seat].push(this.deck.pop());
      }
    }
    const small = live.size === 2 ? this.dealer : this.nextAfter(this.dealer, live);
    const big = this.nextAfter(small, live);
    this.pay(small, Math.min(bigBlind / 2, this.stacks[small]));
    this.pay(big, Math.min(bigBlind, this.stacks[big]));
    this.high = bigBlind;
    this.log("第 " + this.number + " 手 · 发底牌");
    this.advance(big);
    return true;
  }

  log(line) {
    this.history.unshift(line);
    this.history.length = Math.min(45, this.history.length);
  }

  pay(seat, amount) {
    this.stacks[seat] -= amount;
    this.bets[seat] += amount;
    this.total[seat] += amount;
    this.pot += amount;
  }

  contenders() {
    return [...this.playing].filter(seat => !this.folded.has(seat));
  }

  options(seat) {
    const others = this.contenders().filter(other => other !== seat);
    const available = this.bets[seat] + this.stacks[seat];
    const matchable = Math.max(...others.map(other => this.bets[other] + this.stacks[other]));
    const max = Math.min(available, matchable);
    const due = Math.min(this.high, Math.max(...others.map(other => this.bets[other]), 0));
    const anotherCanAct = others.some(other => this.stacks[other] > 0);
    const high = this.high;
    const reopened = this.actedAt[seat] === null || high - this.actedAt[seat] >= this.minRaise;
    return {
      high,
      call: Math.max(0, Math.min(this.stacks[seat], (anotherCanAct ? high : due) - this.bets[seat])),
      max: anotherCanAct && reopened ? max : high,
      min: Math.min(max, high + this.minRaise)
    };
  }

  act(seat, action, target, timedOut = false) {
    if (this.done || this.turn !== seat) return false;
    const { call, high, min, max } = this.options(seat);
    const name = this.names[seat] + (timedOut ? "超时，自动" : "");
    switch (action) {
      case "fold":
        this.folded.add(seat);
        this.log(name + "弃牌");
        break;
      case "pass":
        this.pay(seat, call);
        this.log(name + (call ? "跟注 " + call : "过牌"));
        this.actedAt[seat] = this.high;
        break;
      case "raise":
        if (max <= high || !Number.isInteger(target) || target < min || target > max) return false;
        this.pay(seat, target - this.bets[seat]);
        if (target - high >= this.minRaise) this.minRaise = target - high;
        this.high = target;
        this.actedAt[seat] = target;
        this.log(name + (high ? "加注至 " : "下注 ") + target);
        break;
      default:
        return false;
    }
    this.advance(seat);
    return true;
  }

  advance(previous) {
    const contenders = this.contenders();
    if (contenders.length === 1) {
      this.finish(contenders);
      return;
    }
    const active = contenders.filter(seat => this.stacks[seat] > 0);
    const waiting = active.filter(seat => {
      if (active.length === 1) return this.options(seat).call > 0;
      return this.actedAt[seat] === null || this.bets[seat] < this.high;
    });
    if (waiting.length) {
      this.turn = this.nextAfter(previous, new Set(waiting));
      return;
    }
    if (active.length < 2 || this.street === 3) {
      while (this.street < 3) this.dealStreet();
      this.reveal = true;
      this.finish(contenders);
      return;
    }
    this.dealStreet();
    this.high = 0;
    this.bets.fill(0);
    this.actedAt.fill(null);
    this.minRaise = bigBlind;
    this.turn = this.nextAfter(this.dealer, new Set(active));
  }

  dealStreet() {
    this.street++;
    this.deck.pop();
    const count = this.street === 1 ? 3 : 1;
    for (let index = 0; index < count; index++) this.board.push(this.deck.pop());
    this.log(streets[this.street]);
  }

  finish(contenders) {
    this.done = true;
    this.turn = null;
    const scores = new Map(this.reveal ? contenders.map(seat => [seat, bestHand([...this.hole[seat], ...this.board])]) : []);
    const levels = [...new Set(this.total.filter(Boolean))].sort((a, b) => a - b);
    const winnings = this.names.map(() => 0);
    let previous = 0;
    for (const level of levels) {
      const contributors = [...this.playing].filter(seat => this.total[seat] >= level);
      const amount = (level - previous) * contributors.length;
      previous = level;
      if (contributors.length === 1) {
        this.stacks[contributors[0]] += amount;
        this.pot -= amount;
        continue;
      }
      let eligible = contenders.filter(seat => contributors.includes(seat));
      // A folded overbet can leave an empty side pool. Award it to the remaining hand(s).
      if (!eligible.length) eligible = contenders;
      let winners = [eligible[0]];
      for (const seat of eligible.slice(1)) {
        const order = compare(scores.get(seat), scores.get(winners[0]));
        if (order > 0) winners = [seat];
        if (order === 0) winners.push(seat);
      }
      let odd = amount % winners.length;
      const share = Math.floor(amount / winners.length);
      let seat = this.dealer;
      const tied = new Set(winners);
      for (let count = 0; count < winners.length; count++) {
        seat = this.nextAfter(seat, tied);
        winnings[seat] += share + (odd > 0 ? 1 : 0);
        odd--;
      }
    }
    for (const [seat, amount] of winnings.entries()) this.stacks[seat] += amount;
    this.result = winnings.flatMap((amount, seat) => amount ? [this.names[seat] + "赢得 " + amount] : []).join(" · ");
    for (const [seat, score] of scores) this.log(this.names[seat] + "摊牌：" + handNames[score[0]]);
    this.log(this.result);
  }
}

module.exports = { MultiplayerTable };
