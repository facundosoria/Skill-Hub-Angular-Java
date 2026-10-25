package com.skillhub.infra;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ProbeTargetResolverTest {

    private InfraProperties properties;
    private ProbeTargetResolver resolver;

    @BeforeEach
    void setUp() {
        properties = new InfraProperties();
        properties.setAllowedHosts(List.of("users-service", "*.tpi.local"));
        properties.setAllowedPorts(List.of(8080, 9090));
        resolver = new ProbeTargetResolver(properties);
    }

    @Test
    void allowsApprovedHostPortSchemeAndPath() {
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().toString())
                .isEqualTo("http://users-service:8080/actuator/health");
    }

    @Test
    void allowsWildcardHostSuffix() {
        var decision = resolver.resolve("api.tpi.local", 9090, false, "/actuator/prometheus");
        assertThat(decision.allowed()).isTrue();
    }

    @Test
    void rejectsHostNotInAllowlist() {
        var decision = resolver.resolve("evil.example.com", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void rejectsPortNotAllowedEvenForApprovedHost() {
        var decision = resolver.resolve("users-service", 1337, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("port_not_allowed");
    }

    @Test
    void rejectsSchemeNotAllowed() {
        properties.setAllowedSchemes(List.of("https"));
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("scheme_not_allowed");
    }

    @Test
    void rejectsPathOutsideConfiguredActuatorPaths() {
        var decision = resolver.resolve("users-service", 8080, false, "/etc/passwd");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("path_not_allowed");
    }

    @Test
    void marksManagementMetadataAbsentInsteadOfGuessingPort() {
        var decision = resolver.resolve("users-service", null, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("management_metadata_absent");
    }

    @Test
    void emptyHostAllowlistRejectsEverything() {
        properties.setAllowedHosts(List.of());
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void allowsHostInsideAllowedCidr() {
        properties.setAllowedHosts(List.of("100.64.0.0/10"));
        var decision = resolver.resolve("100.64.1.5", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().getHost()).isEqualTo("100.64.1.5");
    }

    @Test
    void allowsHostMatchingAddressPrefix() {
        properties.setAllowedHosts(List.of("100.64."));
        var decision = resolver.resolve("100.64.1.5", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().getHost()).isEqualTo("100.64.1.5");
    }

    @Test
    void rejectsHostOutsideAllowedCidrWithHostNotAllowlisted() {
        properties.setAllowedHosts(List.of("100.64.0.0/10"));
        var decision = resolver.resolve("10.0.0.1", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void rejectsMissingManagementPortOrHost() {
        assertThat(resolver.resolve("users-service", null, false, "/actuator/health").rejectReason()).isEqualTo("management_metadata_absent");
        assertThat(resolver.resolve("users-service", 0, false, "/actuator/health").rejectReason()).isEqualTo("management_metadata_absent");
        assertThat(resolver.resolve(null, 8080, false, "/actuator/health").rejectReason()).isEqualTo("host_missing");
        assertThat(resolver.resolve("  ", 8080, false, "/actuator/health").rejectReason()).isEqualTo("host_missing");
    }

    @Test
    void rejectsSchemesOutsideTheAllowlist() {
        properties.setAllowedSchemes(List.of("http"));
        assertThat(resolver.resolve("users-service", 8080, true, "/actuator/health").rejectReason()).isEqualTo("scheme_not_allowed");

        properties.setAllowedSchemes(null);
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/health").rejectReason()).isEqualTo("scheme_not_allowed");

        properties.setAllowedSchemes(java.util.Arrays.asList(null, "HTTPS"));
        assertThat(resolver.resolve("users-service", 8080, true, "/actuator/health").allowed()).isTrue();
    }

    @Test
    void rejectsEveryHostWithoutAnAllowlist() {
        properties.setAllowedHosts(null);
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/health").rejectReason()).isEqualTo("host_not_allowlisted");
        properties.setAllowedHosts(List.of());
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/health").rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void ignoresBlankRulesAndMatchesPrefixRules() {
        properties.setAllowedHosts(java.util.Arrays.asList(null, " ", "10.0."));
        assertThat(resolver.resolve("10.0.3.4", 8080, false, "/actuator/health").allowed()).isTrue();
        assertThat(resolver.resolve("11.0.3.4", 8080, false, "/actuator/health").allowed()).isFalse();
    }

    @Test
    void matchesIpv4AndIpv6CidrRules() {
        properties.setAllowedHosts(List.of("100.64.0.0/10", "fd00::/8", "192.168.1.0/24", "10.1.2.3/32"));
        assertThat(resolver.resolve("100.100.1.1", 8080, false, "/actuator/health").allowed()).isTrue();
        assertThat(resolver.resolve("100.128.0.1", 8080, false, "/actuator/health").allowed()).isFalse();
        assertThat(resolver.resolve("192.168.1.77", 8080, false, "/actuator/health").allowed()).isTrue();
        assertThat(resolver.resolve("192.168.2.77", 8080, false, "/actuator/health").allowed()).isFalse();
        assertThat(resolver.resolve("10.1.2.3", 8080, false, "/actuator/health").allowed()).isTrue();
        assertThat(resolver.resolve("fd12::1", 8080, false, "/actuator/health").allowed()).isTrue();
        assertThat(resolver.resolve("fe80::1", 8080, false, "/actuator/health").allowed()).isFalse();
    }

    @Test
    void neverResolvesHostNamesOrMalformedCidrRules() {
        for (String rule : List.of("/24", "10.0.0.0/", "red/24", "10.0.0.0/x", "10.0.0.0/33", "10.0.0.0/-1")) {
            properties.setAllowedHosts(List.of(rule));
            assertThat(resolver.resolve("10.0.0.1", 8080, false, "/actuator/health").allowed()).as(rule).isFalse();
        }
        properties.setAllowedHosts(List.of("10.0.0.0/8"));
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/health").allowed()).isFalse();
        properties.setAllowedHosts(List.of("fd00::/8"));
        assertThat(resolver.resolve("10.0.0.1", 8080, false, "/actuator/health").allowed()).isFalse();
        properties.setAllowedHosts(List.of("10.0.0.0/8"));
        assertThat(resolver.resolve("999.0.0.1", 8080, false, "/actuator/health").allowed()).isFalse();
    }

    @Test
    void rejectsPortsWithoutAnAllowlist() {
        properties.setAllowedPorts(null);
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/health").rejectReason()).isEqualTo("port_not_allowed");
    }

    @Test
    void acceptsOnlyTheConfiguredActuatorPaths() {
        for (String path : java.util.Arrays.asList(null, " ", "actuator/health", "/actuator/../env", "/actuator\\health",
                "/http://evil", "/actuator/env")) {
            assertThat(resolver.resolve("users-service", 8080, false, path).rejectReason()).as(String.valueOf(path)).isEqualTo("path_not_allowed");
        }
        assertThat(resolver.resolve("users-service", 8080, false, "/actuator/prometheus").allowed()).isTrue();
    }
}
