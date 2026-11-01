package com.ballistics.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * Caps {@code /api/**} request bodies at {@code app.http.max-request-body-bytes} (default 64 KiB).
 * Oversized requests are rejected with 413 problem+json before reaching the DispatcherServlet,
 * so they consume no rate-limit tokens and never touch Jackson deserialization.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class RequestBodySizeLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestBodySizeLimitFilter.class);

    private final HttpLimitsProperties props;
    private final ObjectMapper objectMapper;

    public RequestBodySizeLimitFilter(HttpLimitsProperties props, ObjectMapper objectMapper) {
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!request.getRequestURI().startsWith("/api/")) return true;
        String method = request.getMethod();
        return "GET".equals(method) || "HEAD".equals(method) ||
               "OPTIONS".equals(method) || "TRACE".equals(method);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long max = props.maxRequestBodyBytes();

        if (request.getContentLengthLong() > max) {
            log.debug("Rejecting oversized request (Content-Length {} > {})", request.getContentLengthLong(), max);
            reject413(request, response);
            return;
        }

        byte[] body = request.getInputStream().readNBytes((int) (max + 1));
        if (body.length > max) {
            log.debug("Rejecting oversized request (body {} > {})", body.length, max);
            reject413(request, response);
            return;
        }

        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    private void reject413(HttpServletRequest request, HttpServletResponse response) throws IOException {
        ProblemDetail problem = ProblemDetail.forStatus(413);
        problem.setTitle("Content Too Large");
        problem.setDetail("Request body exceeds the " + props.maxRequestBodyBytes() + "-byte limit.");
        problem.setInstance(URI.create(request.getRequestURI()));

        response.setStatus(413);
        response.setContentType("application/problem+json");
        objectMapper.writeValue(response.getOutputStream(), problem);
    }

    static class CachedBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream bais = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public boolean isFinished()                        { return bais.available() == 0; }
                @Override public boolean isReady()                           { return true; }
                @Override public void setReadListener(ReadListener listener) {}
                @Override public int read()                                  { return bais.read(); }
            };
        }

        @Override
        public BufferedReader getReader() {
            String enc = getCharacterEncoding();
            Charset cs = enc != null ? Charset.forName(enc) : StandardCharsets.UTF_8;
            return new BufferedReader(new InputStreamReader(new ByteArrayInputStream(body), cs));
        }

        @Override public int  getContentLength()     { return body.length; }
        @Override public long getContentLengthLong() { return body.length; }
    }
}
