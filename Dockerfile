# syntax=docker/dockerfile:1

# ── Stage 0: Rust/WASM builder ───────────────────────────────────────────────
FROM rust:1.99.1@sha256:8a4e90c7946b74626488b1446f712c0fe0ed1a596cbd3d871684bc9c5433ae07 AS wasm-builder

WORKDIR /app

# Install wasm-pack (same version as CI) and the wasm32 target.
# This layer is cached as long as the Rust toolchain and wasm-pack version are unchanged.
RUN rustup target add wasm32-unknown-unknown && \
    cargo install wasm-pack --locked --version 0.15.1

COPY engine/ engine/

RUN wasm-pack build engine/ --target web --release

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM maven:3-eclipse-temurin-25-alpine@sha256:c9580801980afad4a46ef80927538baf863df198cf4d48879065e408be46d7a2 AS build

WORKDIR /build

# Resolve dependencies as a separate layer — only reruns when pom.xml changes.
# The cache mount keeps ~/.m2 warm across builds without adding it to any layer.
# resolve-plugins captures Maven plugin deps that go-offline alone misses.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B dependency:resolve dependency:resolve-plugins dependency:go-offline -q

COPY src ./src

# Frontend build config (required by frontend-maven-plugin for npm install + Vite build).
COPY package.json package-lock.json vite.config.js ./

# Hand-written engine files staged alongside the WASM output.
# loader.d.ts, protocol.d.ts, worker-core.js, engine-entry.js are authored by the
# frontend layer; they must be present in the integrated build.
COPY engine/stage.sh engine/stage.sh
COPY engine/loader.js engine/protocol.d.ts engine/loader.d.ts \
     engine/worker-core.js engine/engine.worker.js engine/engine-entry.js engine/

# Copy WASM artifacts built in the wasm-builder stage.
COPY --from=wasm-builder /app/engine/pkg/ engine/pkg/

# Stage all engine assets into src/main/resources/static/wasm/ for Vite to bundle.
RUN sh engine/stage.sh

RUN --mount=type=cache,target=/root/.m2 \
    mvn package -DskipTests -Dwasm.required=true -q

# ── Stage 2: extract layered JAR ─────────────────────────────────────────────
FROM eclipse-temurin:25-jre-alpine@sha256:e1898fd6a11fc965a994d8ace186fd3585aeb636cf8f05f47a723fcfee0b0918 AS extract

WORKDIR /extract
COPY --from=build /build/target/*.jar app.jar

# Splits the fat JAR into four layers ordered by change frequency:
#   dependencies → spring-boot-loader → snapshot-dependencies → application
# Docker caches the first three; only the application layer rebuilds on code changes.
RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# ── Stage 3: minimal JRE via jlink ───────────────────────────────────────────
FROM eclipse-temurin:25-jdk-alpine@sha256:c7c3d0bdf7f2bbc5a05a6712ed334d198360105634ea9adf76fca94f381b1e3f AS jlink

RUN jlink \
    --no-header-files \
    --no-man-pages \
    --compress=zip-6 \
    --strip-debug \
    --add-modules \
        java.base,java.desktop,java.instrument,java.management,java.naming,\
        java.net.http,java.security.jgss,java.security.sasl,java.sql,java.xml,\
        jdk.crypto.ec,jdk.management,jdk.naming.dns,jdk.net,jdk.unsupported \
    --output /jre

# ── Stage 4: runtime ─────────────────────────────────────────────────────────
FROM alpine:3.23@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2

RUN addgroup -S spring && adduser -S spring -G spring

WORKDIR /app

COPY --from=jlink /jre /jre

# Copy layers in ascending order of change frequency so Docker maximises cache hits.
COPY --chown=spring:spring --from=extract /extract/extracted/dependencies/ ./
COPY --chown=spring:spring --from=extract /extract/extracted/spring-boot-loader/ ./
COPY --chown=spring:spring --from=extract /extract/extracted/snapshot-dependencies/ ./
COPY --chown=spring:spring --from=extract /extract/extracted/application/ ./

USER spring

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["/jre/bin/java", \
  "-XX:MaxRAMPercentage=75.0", \
  "-XX:+ExitOnOutOfMemoryError", \
  "org.springframework.boot.loader.launch.JarLauncher"]
