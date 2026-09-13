package com.skillhub.config;

import com.skillhub.session.AuthPrincipalResolver;
import com.skillhub.session.PasswordChangeInterceptor;
import com.skillhub.session.SessionService;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final SessionService sessions;
    private final PasswordChangeInterceptor passwordChanges;

    public WebConfig(SessionService sessions, PasswordChangeInterceptor passwordChanges) {
        this.sessions = sessions;
        this.passwordChanges = passwordChanges;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new AuthPrincipalResolver(sessions));
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(passwordChanges).addPathPatterns("/api/**");
    }
}
