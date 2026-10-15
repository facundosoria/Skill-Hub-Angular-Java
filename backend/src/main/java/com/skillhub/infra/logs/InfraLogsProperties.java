package com.skillhub.infra.logs;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.infra.logs")
public class InfraLogsProperties {
    private boolean enabled;
    private String dir = "/var/lib/tpi-log-view/sanitized";

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getDir() { return dir; }
    public void setDir(String dir) { this.dir = dir; }
}
