FROM python:3.11-slim

ARG TERRAFORM_VERSION=1.9.8

WORKDIR /app

# Build deps + terraform binary (arch-aware: works on amd64 and arm64)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl unzip ca-certificates \
    && ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
         amd64) TF_ARCH=amd64 ;; \
         arm64) TF_ARCH=arm64 ;; \
         *) echo "unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${TF_ARCH}.zip" -o /tmp/tf.zip \
    && unzip -q /tmp/tf.zip -d /usr/local/bin \
    && rm /tmp/tf.zip \
    && terraform version \
    && apt-get purge -y --auto-remove curl unzip \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .[dev]

COPY cenote /app/cenote

EXPOSE 8000

CMD ["uvicorn", "cenote.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
