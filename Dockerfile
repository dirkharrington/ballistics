# syntax=docker/dockerfile:1

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-21-alpine AS build

WORKDIR /build

# Resolve dependencies as a separate layer — only reruns when pom.xml changes.
# The cache mount keeps ~/.m2 warm across builds without adding it to any layer.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -q

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn package -DskipTests -q

# ── Stage 2: extract layered JAR ─────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine AS extract

WORKDIR /extract
COPY --from=build /build/target/*.jar app.jar

# Splits the fat JAR into four layers ordered by change frequency:
#   dependencies → spring-boot-loader → snapshot-dependencies → application
# Docker caches the first three; only the application layer rebuilds on code changes.
RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# ── Stage 3: minimal JRE via jlink ───────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS jlink

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
FROM alpine:3.21

RUN addgroup -S spring && adduser -S spring -G spring

WORKDIR /app

COPY --from=jlink /jre /jre

# Copy layers in ascending order of change frequency so Docker maximises cache hits.
COPY --from=extract /extract/extracted/dependencies/ ./
COPY --from=extract /extract/extracted/spring-boot-loader/ ./
COPY --from=extract /extract/extracted/snapshot-dependencies/ ./
COPY --from=extract /extract/extracted/application/ ./

USER spring

EXPOSE 8080

ENTRYPOINT ["/jre/bin/java", "org.springframework.boot.loader.launch.JarLauncher"]
