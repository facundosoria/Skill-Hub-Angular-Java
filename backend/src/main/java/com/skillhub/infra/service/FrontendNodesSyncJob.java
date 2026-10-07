package com.skillhub.infra.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class FrontendNodesSyncJob {
    private final FrontendNodesService frontendNodesService;

    public FrontendNodesSyncJob(FrontendNodesService frontendNodesService) {
        this.frontendNodesService = frontendNodesService;
    }

    @Scheduled(fixedRate = 120000)
    public void sync() {
        frontendNodesService.syncFromTailscale();
    }
}
