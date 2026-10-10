package com.skillhub.infra;

import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * Builds a probe target from registry-derived metadata and validates it against
 * the configured allowlist before any socket is opened. This is the SSRF guard:
 * hosts, ports and schemes coming from the registry are never trusted blindly,
 * and the path is always one of the configured actuator paths, never a URL
 * supplied by a caller.
 */
@Component
public class ProbeTargetResolver {

    private final InfraProperties properties;

    public ProbeTargetResolver(InfraProperties properties) {
        this.properties = properties;
    }

    public record Decision(ProbeTarget target, String rejectReason) {
        public boolean allowed() {
            return target != null;
        }
    }

    public record ProbeTarget(String scheme, String host, int port, String path) {
        public URI uri() {
            return URI.create(scheme + "://" + host + ":" + port + path);
        }
    }

    public Decision resolve(String host, Integer managementPort, boolean secure, String path) {
        if (managementPort == null || managementPort <= 0) {
            return new Decision(null, "management_metadata_absent");
        }
        if (host == null || host.isBlank()) {
            return new Decision(null, "host_missing");
        }
        String scheme = secure ? "https" : "http";
        if (!containsIgnoreCase(properties.getAllowedSchemes(), scheme)) {
            return new Decision(null, "scheme_not_allowed");
        }
        if (!hostAllowed(host)) {
            return new Decision(null, "host_not_allowlisted");
        }
        if (properties.getAllowedPorts() == null || !properties.getAllowedPorts().contains(managementPort)) {
            return new Decision(null, "port_not_allowed");
        }
        if (!pathAllowed(path)) {
            return new Decision(null, "path_not_allowed");
        }
        return new Decision(new ProbeTarget(scheme, host, managementPort, path), null);
    }

    private boolean hostAllowed(String host) {
        List<String> allowed = properties.getAllowedHosts();
        if (allowed == null || allowed.isEmpty()) return false;
        String candidate = host.toLowerCase(Locale.ROOT);
        for (String entry : allowed) {
            if (entry == null || entry.isBlank()) continue;
            String rule = entry.trim().toLowerCase(Locale.ROOT);
            if (rule.contains("/")) {
                if (cidrMatches(rule, candidate)) return true;
            } else if (rule.endsWith(".")) {
                if (candidate.startsWith(rule)) return true;
            } else if (rule.startsWith("*.")) {
                if (candidate.endsWith(rule.substring(1))) return true;
            } else if (rule.equals(candidate)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Matches a literal destination address against a CIDR rule. Both sides must
     * be IP literals, so a host name is never resolved here and no name service
     * lookup is triggered.
     */
    private static boolean cidrMatches(String rule, String candidate) {
        int slash = rule.indexOf('/');
        if (slash <= 0 || slash == rule.length() - 1) return false;
        String network = rule.substring(0, slash);
        if (!isIpLiteral(network) || !isIpLiteral(candidate)) return false;
        int prefix;
        try {
            prefix = Integer.parseInt(rule.substring(slash + 1));
        } catch (NumberFormatException e) {
            return false;
        }
        try {
            byte[] networkBytes = InetAddress.getByName(network).getAddress();
            byte[] candidateBytes = InetAddress.getByName(candidate).getAddress();
            if (networkBytes.length != candidateBytes.length) return false;
            if (prefix < 0 || prefix > networkBytes.length * 8) return false;
            int fullBytes = prefix / 8;
            int remainingBits = prefix % 8;
            for (int i = 0; i < fullBytes; i++) {
                if (networkBytes[i] != candidateBytes[i]) return false;
            }
            if (remainingBits > 0) {
                int mask = 0xFF << (8 - remainingBits);
                return (networkBytes[fullBytes] & mask) == (candidateBytes[fullBytes] & mask);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** True for an IPv4 or IPv6 literal; never resolves a host name. */
    private static boolean isIpLiteral(String value) {
        if (value.contains(":")) return true;
        return value.matches("\\d{1,3}(?:\\.\\d{1,3}){3}");
    }

    private boolean pathAllowed(String path) {
        if (path == null || path.isBlank()) return false;
        if (!path.startsWith("/")) return false;
        if (path.contains("..") || path.contains("\\") || path.contains("://")) return false;
        InfraProperties.ProbePaths configured = properties.getPaths();
        return path.equals(configured.getHealth()) || path.equals(configured.getPrometheus());
    }

    private static boolean containsIgnoreCase(List<String> values, String candidate) {
        if (values == null) return false;
        for (String value : values) {
            if (value != null && value.equalsIgnoreCase(candidate)) return true;
        }
        return false;
    }
}
