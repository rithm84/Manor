FROM golang:1.24.7-bookworm AS go
RUN GOBIN=/opt/go-tools go install golang.org/x/tools/gopls@v0.19.1
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive SANDBOX_DISABLE_PROCESS_LOGGING=true
RUN apt-get update && apt-get install -y --no-install-recommends python3 nodejs npm openjdk-21-jdk-headless gcc g++ make clangd-18 bubblewrap util-linux curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=go /usr/local/go /usr/local/go
COPY --from=go /opt/go-tools/gopls /usr/local/bin/gopls
ENV PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
RUN npm install --prefix /opt/languages pyright@1.1.405 typescript@5.9.3 typescript-language-server@4.4.1 ws@8.18.3
RUN mkdir -p /opt/jdtls && curl -fsSL https://download.eclipse.org/jdtls/milestones/1.50.0/jdt-language-server-1.50.0-202509041425.tar.gz | tar -xz -C /opt/jdtls
RUN ln -s /usr/bin/clangd-18 /usr/local/bin/clangd
RUN ln -s /opt/jdtls/plugins/org.eclipse.equinox.launcher_*.jar /opt/jdtls/launcher.jar
RUN /usr/sbin/useradd --uid 10001 --create-home runner && mkdir /workspace && chown runner:runner /workspace
COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api
COPY runner.py lsp.mjs /opt/manor/
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh && chmod -R a+rX /opt/manor /opt/jdtls /opt/languages
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
