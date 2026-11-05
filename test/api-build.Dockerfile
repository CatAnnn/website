# Use BuildKit's bundled Dockerfile frontend to avoid an extra Docker Hub pull.

# Multi-stage build — builder + minimal JRE runtime

# Maven is preinstalled here so the build does not depend on the Alpine
# BusyBox wget implementation used by the Maven wrapper.
FROM maven:3.9.9-eclipse-temurin-21-alpine AS builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

# Build-only proxy settings. They are not present in the runtime image.
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY}

WORKDIR /build

# Maven does not consume HTTP(S)_PROXY automatically. Generate its proxy
# settings at build time without persisting proxy credentials in the image.
RUN cat > /usr/local/bin/mvn-build <<'EOF'
#!/bin/sh
set -eu

# Secret mounts are evaluated in the Maven RUN step so a cached layer created
# without a CA cannot prevent a later proxy build from importing it.
if [ -s /run/secrets/corporate-ca ]; then
    keytool -delete -alias corporate-proxy-ca -cacerts -storepass changeit >/dev/null 2>&1 || true
    keytool -importcert -noprompt -trustcacerts \
        -alias corporate-proxy-ca \
        -file /run/secrets/corporate-ca \
        -cacerts -storepass changeit
fi

settings_file="${MAVEN_CONFIG:-/root/.m2}/settings.xml"
proxy_url="${https_proxy:-${http_proxy:-}}"
# Compose maps host.docker.internal to the Docker host. Translate the common
# host-loopback proxy form so it is reachable from the build container.
proxy_url="$(printf '%s' "$proxy_url" | sed \
    -e 's#://127\\.0\\.0\\.1:#://host.docker.internal:#' \
    -e 's#://localhost:#://host.docker.internal:#' \
    -e 's#@127\\.0\\.0\\.1:#@host.docker.internal:#' \
    -e 's#@localhost:#@host.docker.internal:#')"

if [ -n "$proxy_url" ]; then
    proxy_scheme="${proxy_url%%://*}"
    if [ "$proxy_scheme" = "$proxy_url" ]; then
        proxy_scheme=http
        proxy_authority="$proxy_url"
    else
        proxy_authority="${proxy_url#*://}"
    fi

    case "$proxy_scheme" in
        http|https) ;;
        *) proxy_scheme=http ;;
    esac

    proxy_credentials=
    case "$proxy_authority" in
        *@*)
            proxy_credentials="${proxy_authority%@*}"
            proxy_authority="${proxy_authority#*@}"
            ;;
    esac

    case "$proxy_authority" in
        \[*\]:*)
            proxy_host="${proxy_authority#\[}"
            proxy_host="${proxy_host%%\]*}"
            proxy_port="${proxy_authority##*\]:}"
            ;;
        *:*)
            proxy_host="${proxy_authority%%:*}"
            proxy_port="${proxy_authority##*:}"
            ;;
        *)
            proxy_host="$proxy_authority"
            proxy_port=80
            [ "$proxy_scheme" = https ] && proxy_port=443
            ;;
    esac

    non_proxy_hosts="$(printf '%s' "${no_proxy:-}" | tr ',' '|')"
    mkdir -p "$(dirname "$settings_file")"
    {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
        printf '%s\n' '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">'
        printf '%s\n' '  <proxies>'
        printf '%s\n' '    <proxy>'
        printf '%s\n' '      <id>build-proxy</id>'
        printf '%s\n' '      <active>true</active>'
        printf '      <protocol>%s</protocol>\n' "$proxy_scheme"
        printf '      <host>%s</host>\n' "$proxy_host"
        printf '      <port>%s</port>\n' "$proxy_port"
        if [ -n "$proxy_credentials" ]; then
            export MAVEN_PROXY_USERNAME="${proxy_credentials%%:*}"
            export MAVEN_PROXY_PASSWORD="${proxy_credentials#*:}"
            printf '%s\n' '      <username>${env.MAVEN_PROXY_USERNAME}</username>'
            printf '%s\n' '      <password>${env.MAVEN_PROXY_PASSWORD}</password>'
        fi
        if [ -n "$non_proxy_hosts" ]; then
            printf '      <nonProxyHosts>%s</nonProxyHosts>\n' "$non_proxy_hosts"
        fi
        printf '%s\n' '    </proxy>'
        printf '%s\n' '  </proxies>'
        printf '%s\n' '</settings>'
    } > "$settings_file"
else
    # Do not let a proxy settings file from a previous cache use stale values.
    rm -f "$settings_file"
fi

exec mvn "$@"
EOF
RUN chmod +x /usr/local/bin/mvn-build

# Layer dependency resolution separately for better cache hits
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    --mount=type=secret,id=corporate-ca,required=false \
    /usr/local/bin/mvn-build dependency:go-offline -q

COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    --mount=type=secret,id=corporate-ca,required=false \
    /usr/local/bin/mvn-build package -DskipTests -Dspotless.check.skip=true -q

# Extract layered jar for faster subsequent image rebuilds
RUN java -Djarmode=layertools -jar target/*.jar extract --destination target/extracted

# Optional targets used by the Makefile. They keep verification on Java 21 even
# when the host JDK is older. Neither target is part of the production image.
FROM builder AS unit-test
RUN --mount=type=cache,target=/root/.m2 \
    --mount=type=secret,id=corporate-ca,required=false \
    /usr/local/bin/mvn-build verify -Dspotless.check.skip=true -q

FROM builder AS integration-test
RUN --mount=type=cache,target=/root/.m2 \
    --mount=type=secret,id=corporate-ca,required=false \
    /usr/local/bin/mvn-build dependency:go-offline -Pintegration -q && \
    mkdir -p /opt/maven-repository && \
    cp -a /root/.m2/. /opt/maven-repository/

# Maven runs offline from the copied cache. Testcontainers itself uses the
# host Docker socket supplied by the Compose test service.
ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    NO_PROXY= \
    http_proxy= \
    https_proxy= \
    no_proxy=
ENTRYPOINT ["mvn", "-o", "-Dmaven.repo.local=/opt/maven-repository/repository", "-Dapi.version=1.40", "-Dspotless.check.skip=true", "test", "-Pintegration"]

# ── Stage 2: minimal runtime ──────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S hackhub && adduser -S hackhub -G hackhub
USER hackhub

WORKDIR /app

COPY --from=builder --chown=hackhub:hackhub /build/target/extracted/dependencies/ ./
COPY --from=builder --chown=hackhub:hackhub /build/target/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=hackhub:hackhub /build/target/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=hackhub:hackhub /build/target/extracted/application/ ./

EXPOSE 8080 8081

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:8081/actuator/health | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-Djava.security.egd=file:/dev/./urandom", \
  "org.springframework.boot.loader.launch.JarLauncher"]
