---
slug: java-spring-boot-conventions
title: Java Spring Boot Conventions
description: 'Rules for Spring Boot 3 services: Java records for DTOs, constructor injection, and Flyway
  migrations.'
when_to_use: writing Java Spring Boot endpoints, defining DTOs as records, creating Flyway migrations
stack: java
type: convention
owning_team: admin
version: 1
tags:
- backend
- convention
- flyway
- java
- records
- spring-boot
---

## Rule

Write Spring Boot 3 backend services with modern Java 21 features: immutable `record` types for DTOs, constructor-based dependency injection, and versioned Flyway database migrations.

### Architecture Guidelines
- DTOs and Data Transfer: Use immutable Java `record` types for all HTTP request and response payloads.
- Dependency Injection: Use explicit constructor injection with `final` fields; avoid field-level `@Autowired`.
- Database Migrations: Never modify existing migration scripts. Always create a new versioned Flyway file in `db/migration/V{n}__*.sql`.
- Testing and Verification: Validate every backend change by executing `mvn test` inside the backend directory.
