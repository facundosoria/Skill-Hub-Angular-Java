package com.skillhub.infra;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Configuration for the infra monitoring feature, under {@code app.infra}.
 *
 * The feature is OFF by default ({@code enabled=false}) and makes no network
 * call at startup, so Skill Hub starts and serves exactly as before whether or
 * not infrastructure monitoring is configured. Everything externally
 * configurable lives here: the service catalogue, probe interval, timeouts,
 * concurrency, thresholds, retention and the destination allowlist that a
 * probe target must match before any HTTP request is made.
 */
@Component
@ConfigurationProperties(prefix = "app.infra")
public class InfraProperties {

    /** Master switch. When false the monitor never schedules and the API reports a disabled state. */
    private boolean enabled = false;

    /** Eureka registry base URL, e.g. http://eureka:8761/eureka. Empty means registry unavailable. */
    private String eurekaUrl = "";

    /** How often the bounded scheduler runs one observation cycle. */
    private Duration interval = Duration.ofSeconds(30);

    /** Connect timeout per HTTP probe/registry call. */
    private Duration connectTimeout = Duration.ofSeconds(2);

    /** Read timeout per HTTP probe/registry call. */
    private Duration readTimeout = Duration.ofSeconds(3);

    /** Upper bound on concurrent in-flight probes; backed by a dedicated bounded executor. */
    private int maxConcurrency = 4;

    /** Consecutive failing cycles before an UP service is committed as DOWN. */
    private int failureThreshold = 3;

    /** Consecutive healthy cycles before a DOWN service is committed back as UP. */
    private int recoveryThreshold = 2;

    /** An actuator response slower than this marks the instance DEGRADED (still serving, limited). */
    private Duration degradeLatency = Duration.ofMillis(1500);

    /**
     * Maximum spacing between two observations that still counts as observed
     * time. A larger spacing is a gap (restart, outage) and contributes zero
     * observed/healthy seconds, so an old UP is never extended across it.
     */
    private Duration staleObservationGrace = Duration.ofSeconds(90);

    /** Observation retention. Cleanup is bounded and never deletes other schemas. */
    private int retentionDays = 90;

    /** Short availability window. */
    private Duration availabilityWindow24h = Duration.ofHours(24);

    /** Long availability window. */
    private Duration availabilityWindow7d = Duration.ofDays(7);

    /** Allowed probe URL schemes. Anything else is rejected before any socket is opened. */
    private List<String> allowedSchemes = new ArrayList<>(List.of("http", "https"));

    /**
     * Allowed probe hosts (case-insensitive): an exact host name, a
     * {@code *.suffix} wildcard, a CIDR such as {@code 100.64.0.0/10} matched
     * against a literal destination address, or a trailing-dot address prefix
     * such as {@code 100.64.}.
     */
    private List<String> allowedHosts = new ArrayList<>();

    /**
     * Allowed probe destination ports. A management port coming from registry
     * metadata must be present here before it is used. Empty means no probe
     * target is approved. Defaults cover the 12 micros plus the gateway
     * management ports (DEC-28: management = app + 1).
     */
    private List<Integer> allowedPorts = new ArrayList<>(List.of(
            8000, 8001, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8090, 8761, 9090,
            8089, 8091, 8093, 8095, 8097, 8099, 8101, 8103, 8011));

    private ProbePaths paths = new ProbePaths();

    /** Independent service catalogue. Defaults to the expected micro list. */
    private List<ServiceDefinition> catalogue = defaultCatalogue();

    private Tailscale tailscale = new Tailscale();

    public static class ProbePaths {
        /** Actuator health path, relative to the instance management port. */
        private String health = "/actuator/health";
        /** Prometheus/actuator metrics path, relative to the instance management port. */
        private String prometheus = "/actuator/prometheus";
        public String getHealth() { return health; }
        public void setHealth(String health) { this.health = health; }
        public String getPrometheus() { return prometheus; }
        public void setPrometheus(String prometheus) { this.prometheus = prometheus; }
    }

    public static class ServiceDefinition {
        /** Canonical service name, exactly as exposed by the API. */
        private String name;
        /** Eureka application id; defaults to {@code name} and matched case-insensitively. */
        private String eurekaApp;
        /** Optional management port override when the registry metadata has none. */
        private Integer managementPort;
        private int sortOrder;
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getEurekaApp() { return eurekaApp; }
        public void setEurekaApp(String eurekaApp) { this.eurekaApp = eurekaApp; }
        public Integer getManagementPort() { return managementPort; }
        public void setManagementPort(Integer managementPort) { this.managementPort = managementPort; }
        public int getSortOrder() { return sortOrder; }
        public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
    }

    public static class Tailscale {
        /** Off by default. Node listing stays pending until explicitly configured. */
        private boolean enabled = false;
        private String apiUrl = "https://api.tailscale.com";
        private String tailnet = "";
        private String apiKey = "";
        /** Only nodes carrying this tag are listed. */
        private String tagFilter = "tag:frontend-edge";
        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getApiUrl() { return apiUrl; }
        public void setApiUrl(String apiUrl) { this.apiUrl = apiUrl; }
        public String getTailnet() { return tailnet; }
        public void setTailnet(String tailnet) { this.tailnet = tailnet; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getTagFilter() { return tagFilter; }
        public void setTagFilter(String tagFilter) { this.tagFilter = tagFilter; }
    }

    public static List<ServiceDefinition> defaultCatalogue() {
        String[] names = {
                "users-service",
                "course-service",
                "engine-challenge-service",
                "theoretical-challenge-service",
                "practical-challenge-service",
                "sandbox-service",
                "llm-service",
                "accounting-service",
                "market-service",
                "roadmap-service",
                "notifications-service",
                "backoffice-service",
                "api-gateway",
        };
        List<ServiceDefinition> list = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            ServiceDefinition def = new ServiceDefinition();
            def.setName(names[i]);
            def.setEurekaApp(names[i]);
            def.setSortOrder(i);
            list.add(def);
        }
        return list;
    }

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getEurekaUrl() { return eurekaUrl; }
    public void setEurekaUrl(String eurekaUrl) { this.eurekaUrl = eurekaUrl; }
    public Duration getInterval() { return interval; }
    public void setInterval(Duration interval) { this.interval = interval; }
    public Duration getConnectTimeout() { return connectTimeout; }
    public void setConnectTimeout(Duration connectTimeout) { this.connectTimeout = connectTimeout; }
    public Duration getReadTimeout() { return readTimeout; }
    public void setReadTimeout(Duration readTimeout) { this.readTimeout = readTimeout; }
    public int getMaxConcurrency() { return maxConcurrency; }
    public void setMaxConcurrency(int maxConcurrency) { this.maxConcurrency = maxConcurrency; }
    public int getFailureThreshold() { return failureThreshold; }
    public void setFailureThreshold(int failureThreshold) { this.failureThreshold = failureThreshold; }
    public int getRecoveryThreshold() { return recoveryThreshold; }
    public void setRecoveryThreshold(int recoveryThreshold) { this.recoveryThreshold = recoveryThreshold; }
    public Duration getDegradeLatency() { return degradeLatency; }
    public void setDegradeLatency(Duration degradeLatency) { this.degradeLatency = degradeLatency; }
    public Duration getStaleObservationGrace() { return staleObservationGrace; }
    public void setStaleObservationGrace(Duration staleObservationGrace) { this.staleObservationGrace = staleObservationGrace; }
    public int getRetentionDays() { return retentionDays; }
    public void setRetentionDays(int retentionDays) { this.retentionDays = retentionDays; }
    public Duration getAvailabilityWindow24h() { return availabilityWindow24h; }
    public void setAvailabilityWindow24h(Duration availabilityWindow24h) { this.availabilityWindow24h = availabilityWindow24h; }
    public Duration getAvailabilityWindow7d() { return availabilityWindow7d; }
    public void setAvailabilityWindow7d(Duration availabilityWindow7d) { this.availabilityWindow7d = availabilityWindow7d; }
    public List<String> getAllowedSchemes() { return allowedSchemes; }
    public void setAllowedSchemes(List<String> allowedSchemes) { this.allowedSchemes = allowedSchemes; }
    public List<String> getAllowedHosts() { return allowedHosts; }
    public void setAllowedHosts(List<String> allowedHosts) { this.allowedHosts = allowedHosts; }
    public List<Integer> getAllowedPorts() { return allowedPorts; }
    public void setAllowedPorts(List<Integer> allowedPorts) { this.allowedPorts = allowedPorts; }
    public ProbePaths getPaths() { return paths; }
    public void setPaths(ProbePaths paths) { this.paths = paths; }
    public List<ServiceDefinition> getCatalogue() { return catalogue; }
    public void setCatalogue(List<ServiceDefinition> catalogue) { this.catalogue = catalogue; }
    public Tailscale getTailscale() { return tailscale; }
    public void setTailscale(Tailscale tailscale) { this.tailscale = tailscale; }
}
