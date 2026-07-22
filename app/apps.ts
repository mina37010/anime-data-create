export type AppDefinition = {
  href: string;
  name: string;
  description: string;
  status: "available" | "planned";
};

export const apps: AppDefinition[] = [
  {
    href: "/apps/keyframe",
    name: "原画キーフレーム入力",
    description: "画像を順番に確認し、レイヤー・番号・修正原画・矩形をCSV化します。",
    status: "available",
  },
  {
    href: "/apps/layout-rough",
    name: "レイアウト・ラフ原画入力",
    description: "レイアウト、ラフ原画、修正、参考、Book、白紙をCSV化します。",
    status: "available",
  },
];
