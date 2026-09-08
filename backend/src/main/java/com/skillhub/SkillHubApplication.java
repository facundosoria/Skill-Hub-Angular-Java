package com.skillhub;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SkillHubApplication {
    public static void main(String[] args) {
        SpringApplication.run(SkillHubApplication.class, args);
    }
}
