package com.skillhub.infra.logs;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;

/** Hides literal search queries from servlet/MVC request diagnostics. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class LogsRequestFilter extends OncePerRequestFilter {
    static final String BASE = "/api/infra/logs/api-gateway";
    static final String CACHE_CONTROL = "private, no-store, no-transform";
    static final String RAW_QUERY = LogsRequestFilter.class.getName() + ".rawQuery";
    static final String PARAMETERS = LogsRequestFilter.class.getName() + ".parameters";
    private final InfraLogsProperties properties;
    private final ObjectMapper mapper;

    public LogsRequestFilter(InfraLogsProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
    }

    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !path.equals(BASE) && !path.startsWith(BASE + "/");
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                               FilterChain chain) throws ServletException, IOException {
        response.setHeader("Cache-Control", CACHE_CONTROL);
        if (!properties.isEnabled()) {
            response.setStatus(404);
            response.setContentType("application/json");
            mapper.writeValue(response.getWriter(), Map.of("code", "LOGS_DISABLED", "message", "Los logs no están habilitados."));
            return;
        }
        request.setAttribute(RAW_QUERY, request.getQueryString());
        request.setAttribute(PARAMETERS, request.getParameterMap());
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public String getQueryString() { return null; }
            @Override public Map<String, String[]> getParameterMap() { return Map.of(); }
            @Override public java.util.Enumeration<String> getParameterNames() { return java.util.Collections.emptyEnumeration(); }
            @Override public String getParameter(String name) { return null; }
            @Override public String[] getParameterValues(String name) { return null; }
        }, response);
    }
}
