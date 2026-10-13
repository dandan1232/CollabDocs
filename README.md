# CollabDocs

一个面向多人实时协作与内容创作的在线文档工作室。

## 作者

念安 / dandan1232

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

## 自动交付

GitHub Actions 会在拉取请求和 `main` 分支提交上运行完整质量检查。发布和部署
需要在 Actions 的 Delivery 工作流中手动点击 Run workflow（`workflow_dispatch`）。
手动运行的检查通过后，工作流会把 `web`、`realtime` 和 `migrate` 镜像发布到 GHCR，
再让生产服务器拉取带 Git commit SHA 的固定版本。

MinIO 的官方预编译镜像已无法下载。首次在没有旧镜像的环境运行时，先执行
`docker compose build minio minio-init`，从官方源码构建项目锁定的 MinIO 和 mc
版本。自动测试会执行这一步；现有生产服务器继续使用已缓存的同版本镜像。

在 GitHub 的 `production` Environment 中配置以下 5 个必需 Secrets：

- `DEPLOY_HOST`：生产服务器地址。
- `DEPLOY_USER`：拥有部署目录和 Docker 权限的 SSH 用户。
- `DEPLOY_SSH_KEY`：部署专用私钥。
- `DEPLOY_KNOWN_HOSTS`：由 `ssh-keyscan` 获取并人工核验的服务器主机指纹。
- `COLLABDOCS_BASE_URL`：生产站点 HTTPS 地址，用于部署后冒烟检查。

当前 GHCR 镜像公开，服务器可以匿名拉取。私有镜像需要同时配置以下可选 Secrets，
只填写其中一项会使配置检查失败：

- `GHCR_USERNAME`：服务器拉取 GHCR 镜像所使用的 GitHub 用户名。
- `GHCR_READ_TOKEN`：仅授予 `read:packages` 的 GitHub token。

可选 Variables：`DEPLOY_PATH`（默认 `/opt/collabdocs`）和
`DEPLOY_SSH_PORT`（默认 `22`）。现有生产服务器应设置
`DEPLOY_PATH=/home/ubuntu/collab-docs`，与实际部署目录一致。
服务器的 `DEPLOY_PATH/.env` 继续保存生产环境变量和数据库、对象存储凭据，
不上传到 GitHub。

首次从本地镜像切换到 GHCR 前，先备份原 Compose 配置并记录现有镜像 ID。
首次部署没有上一 GHCR 版本可自动回滚，失败时应使用原配置和本地镜像手动恢复。
部署流程保留服务器上的旧镜像和 `CollabDocs-*.tar` 归档，不自动清理。
确认无需旧备份后，可手动运行 `scripts/deploy-production.sh cleanup`。
GHCR 每周自动保留每个服务最近 10 个镜像版本。
