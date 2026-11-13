import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages 项目位于仓库子路径，使用相对资源地址也兼容根目录部署。
  base: "./",
});
