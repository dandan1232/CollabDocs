# CollabDocs

一个面向多人实时协作与内容创作的在线文档工作室。

## 作者

念安 / dandan1232

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

## 自动交付

GitHub Actions 会在拉取请求和 `main` 分支提交上运行完整质量检查。`main`
检查通过后，工作流会把 `web`、`realtime` 和 `migrate` 镜像发布到 GHCR，
再让生产服务器拉取带 Git commit SHA 的固定版本。部署不再生成或传输 tar 包。

在 GitHub 的 `production` Environment 中配置以下 Secrets：

- `DEPLOY_HOST`：生产服务器地址。
- `DEPLOY_USER`：拥有部署目录和 Docker 权限的 SSH 用户。
- `DEPLOY_SSH_KEY`：部署专用私钥。
- `DEPLOY_KNOWN_HOSTS`：由 `ssh-keyscan` 获取并人工核验的服务器主机指纹。
- `GHCR_USERNAME`：服务器拉取 GHCR 镜像所使用的 GitHub 用户名。
- `GHCR_READ_TOKEN`：仅授予 `read:packages` 的 GitHub token。
- `COLLABDOCS_BASE_URL`：生产站点 HTTPS 地址，用于部署后冒烟检查。

可选 Variables：`DEPLOY_PATH`（默认 `/opt/collabdocs`）和
`DEPLOY_SSH_PORT`（默认 `22`）。服务器的 `DEPLOY_PATH/.env` 继续保存生产环境
变量和数据库、对象存储凭据，不上传到 GitHub。

GHCR 每周自动保留每个服务最近 10 个镜像版本。服务器保留当前版本和上一个
回滚版本，并只清理 CollabDocs 自身的旧镜像与历史 `CollabDocs-*.tar` 归档。
