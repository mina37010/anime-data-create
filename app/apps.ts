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
  {
    href: "/apps/timesheet",
    name: "タイムシート入力",
    description: "画像とXLSXを読み込み、秒数・フレーム数・レイヤーを編集して書き出します。",
    status: "available",
  },
  {
    href: "/apps/iiif-manifest",
    name: "背景IIIF Manifest作成",
    description: "背景フォルダの画像を分類し、フォルダごとのIIIF manifestを生成します。",
    status: "available",
  },
  {
    href: "/apps/cut-bag",
    name: "カット袋入力",
    description: "カット袋画像の領域を指定し、カット番号や担当者などの項目をCSV化します。",
    status: "available",
  },
];
