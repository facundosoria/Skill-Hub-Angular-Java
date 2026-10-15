package com.skillhub.infra.logs;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping(LogsRequestFilter.BASE)
public class InfraLogsController {
    private final SanitizedLogStore store;
    private final InfraLogStreams streams;
    private final LogsAccessLimiter limiter;

    public InfraLogsController(SanitizedLogStore store, InfraLogStreams streams, LogsAccessLimiter limiter) {
        this.store = store;
        this.streams = streams;
        this.limiter = limiter;
    }

    @GetMapping
    public LogsDto.Page page(@AuthPrincipal CurrentUser user, HttpServletRequest request) {
        LogsQuery query = LogsQuery.parse(parameters(request), rawQuery(request), false, null);
        limiter.history(user.id());
        return store.page(query);
    }

    @GetMapping("/status")
    public LogsDto.Status status(@AuthPrincipal CurrentUser user, HttpServletRequest request) {
        LogsQuery.validateStatus(parameters(request), rawQuery(request));
        limiter.history(user.id());
        return store.status(limiter.activeStreams(), limiter.blockedUntil(user.id()));
    }

    @GetMapping(value = "/stream", produces = "text/event-stream")
    public SseEmitter stream(@AuthPrincipal CurrentUser user, HttpServletRequest request, HttpServletResponse response) {
        LogsQuery query = LogsQuery.parse(parameters(request), rawQuery(request), true, request.getHeader("Last-Event-ID"));
        String token = null;
        if (request.getCookies() != null) {
            for (Cookie cookie : request.getCookies()) {
                if ("skillhub_session".equals(cookie.getName())) { token = cookie.getValue(); break; }
            }
        }
        response.setHeader("X-Accel-Buffering", "no");
        return streams.open(user, token, query);
    }

    private String rawQuery(HttpServletRequest request) {
        Object raw = request.getAttribute(LogsRequestFilter.RAW_QUERY);
        return raw == null ? request.getQueryString() : raw.toString();
    }

    @SuppressWarnings("unchecked")
    private java.util.Map<String, String[]> parameters(HttpServletRequest request) {
        Object parameters = request.getAttribute(LogsRequestFilter.PARAMETERS);
        return parameters == null ? request.getParameterMap() : (java.util.Map<String, String[]>) parameters;
    }
}
