# syntax=docker/dockerfile:1

# --- build ---------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# Capa de dependencias: solo se invalida si cambia el pom.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline
COPY src ./src
# Los tests usan Testcontainers (necesitan Docker); en la imagen se saltan.
RUN --mount=type=cache,target=/root/.m2 mvn -B -q clean package -DskipTests

# --- runtime ------------------------------------------------------------
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/skill-hub-backend-0.1.0-SNAPSHOT.jar app.jar
EXPOSE 8080
USER 1001:1001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
