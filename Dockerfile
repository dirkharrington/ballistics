# syntax=docker/dockerfile:1

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM maven:3-eclipse-temurin-26-alpine@sha256:232a4e81490a806193c71ba2d170fdbc467bae2549674853d8b84f44d06a9018 AS build

WORKDIR /build

# Resolve dependencies as a separate layer — only reruns when pom.xml changes.
# The cache mount keeps ~/.m2 warm across builds without adding it to any layer.
# resolve-plugins captures Maven plugin deps that go-offline alone misses.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B dependency:resolve dependency:resolve-plugins dependency:go-offline -q

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn package -DskipTests -q

# ── Stage 2: extract layered JAR ─────────────────────────────────────────────
FROM eclipse-temurin:25-jre-alpine@sha256:c707c0d18cb9e8556380719f80d96a7529d0746fbb42143893949b98ed2f8943 AS extract

WORKDIR /extract
COPY --from=build /build/target/*.jar app.jar

# Splits the fat JAR into four layers ordered by change frequency:
#   dependencies → spring-boot-loader → snapshot-dependencies → application
# Docker caches the first three; only the application layer rebuilds on code changes.
RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# ── Stage 3: minimal JRE via jlink ───────────────────────────────────────────
FROM eclipse-temurin:25-jdk-alpine@sha256:30d9f87d702c2c1c601ed0d31e0c88ea1ea474ee7676cda7b7a59e759181c4dd AS jlink

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
FROM alpine:3.23@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11

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
