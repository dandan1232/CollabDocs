import { Avatar, Style } from "@dicebear/core";
import lorelei from "@dicebear/styles/lorelei.json" with { type: "json" };
import { uniqueNamesGenerator } from "unique-names-generator";

const adjectives = [
  "安静的",
  "爱笑的",
  "沉着的",
  "聪明的",
  "从容的",
  "好奇的",
  "和煦的",
  "机灵的",
  "坚定的",
  "开朗的",
  "浪漫的",
  "敏锐的",
  "耐心的",
  "轻快的",
  "热忱的",
  "认真的",
  "温柔的",
  "稳健的",
  "勇敢的",
  "自在的",
] as const;

const animals = [
  "白鹭",
  "斑鹿",
  "赤狐",
  "海獭",
  "河狸",
  "灰鲸",
  "金丝雀",
  "考拉",
  "蓝鲸",
  "猎豹",
  "猫头鹰",
  "梅花鹿",
  "蜜獾",
  "企鹅",
  "山雀",
  "松鼠",
  "水獭",
  "小熊猫",
  "雪豹",
  "云雀",
] as const;

const presenceColors = [
  "#C96F48",
  "#586B4C",
  "#A35D50",
  "#92743F",
  "#3F7568",
  "#B35C37",
  "#6E7951",
  "#9A6847",
] as const;

const loreleiStyle = new Style(lorelei);

export interface GuestProfile {
  nickname: string;
  avatarSeed: string;
  presenceColor: (typeof presenceColors)[number];
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function generateGuestProfile(seed: string): GuestProfile {
  const numericSeed = hashSeed(seed);

  return {
    nickname: uniqueNamesGenerator({
      dictionaries: [Array.from(adjectives), Array.from(animals)],
      separator: "",
      length: 2,
      seed: numericSeed,
    }),
    avatarSeed: seed,
    presenceColor: presenceColors[numericSeed % presenceColors.length]!,
  };
}

export function renderGuestAvatar(seed: string): string {
  return new Avatar(loreleiStyle, {
    seed,
    size: 128,
    borderRadius: 24,
    backgroundColor: ["f1eadb", "d9e2d1", "ecd4c6", "e7dcc2"],
  }).toString();
}
