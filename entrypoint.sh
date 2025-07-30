#!/bin/sh

set -e

# --- 变量定义 ---
DATA_DIR="/app/data"
DEFAULT_CONFIG="/app/config.yaml.default"
CONFIG_FILE="${DATA_DIR}/config.yaml"

# --- 目录初始化 ---
# 确保所有持久化数据卷中需要用到的目录都存在
echo "Ensuring persistent data directories exist..."
mkdir -p "${DATA_DIR}/icons"
mkdir -p "${DATA_DIR}/backgrounds"

# --- 配置检查与处理 ---
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Configuration file not found. Initializing from default template and environment variables..."
    
    # 1. 复制默认配置
    cp "$DEFAULT_CONFIG" "$CONFIG_FILE"
    
    # 2. 使用 yq 和环境变量更新配置
    if [ -n "$ICON_STORAGE_STRATEGY" ]; then
      yq e '.icon_storage.strategy = env("ICON_STORAGE_STRATEGY")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ENDPOINT" ]; then
      yq e '.minio.endpoint = env("MINIO_ENDPOINT")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ACCESS_KEY" ]; then
      yq e '.minio.access_key = env("MINIO_ACCESS_KEY")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_SECRET_KEY" ]; then
      yq e '.minio.secret_key = env("MINIO_SECRET_KEY")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ICONS_BUCKET_NAME" ]; then
      yq e '.minio.icons_bucket = env("MINIO_ICONS_BUCKET_NAME")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_BACKGROUND_BUCKET_NAME" ]; then
      yq e '.minio.background_bucket = env("MINIO_BACKGROUND_BUCKET_NAME")' -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_USE_SSL" ]; then
      yq e '.minio.use_ssl = env("MINIO_USE_SSL")' -i "$CONFIG_FILE"
    fi
    if [ -n "$DOCKER_API_ENDPOINT" ]; then
      yq e '.docker_api_endpoint = env("DOCKER_API_ENDPOINT")' -i "$CONFIG_FILE"
    fi
    
    echo "Initialization complete."
else
    echo "Existing configuration file found at ${CONFIG_FILE}. Skipping environment variable modifications."
fi

# --- 启动应用 ---
echo "Starting application..."
exec "$@"