# 设计器验收报告：三室一厅一卫

文件：/Users/worker/Desktop/projects/threejs-home/floorplan-3d/三室一厅-装修设计器.html
只跑了：点选、拖四边（不是完整验收）
模式：--lite（1280×800、快速画质）
结果：**2 / 2 通过**

| # | 项目 | 结果 | 说明 | 截图 |
|---|---|---|---|---|
| 1 | 家具：点选 / 拖动 / R 旋转 / Ctrl+D 复制 / Delete 删除 | ✅ |  | shots/001_家具：点选_拖动_R_旋转_Ctrl+D_复制_Delete_删除.png |
| 2 | 家具：拖四边 / 四角改宽深、尺寸牌输入宽深高、拖动改高度 | ✅ |  | shots/002_家具：拖四边_四角改宽深、尺寸牌输入宽深高、拖动改高度.png |

导出的文件在 downloads/，用 `python scripts/qa_files.py <输出目录>/downloads` 检查能不能打开。