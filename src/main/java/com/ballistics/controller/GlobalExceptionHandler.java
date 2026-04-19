package com.ballistics.controller;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.stream.Collectors;

/**
 * Centralizes RFC 7807 ProblemDetail error responses for all controllers.
 *
 * <p>Extends {@link ResponseEntityExceptionHandler} so all built-in Spring MVC
 * exception mappings are inherited. The one override here improves on the
 * default {@code MethodArgumentNotValidException} handling by surfacing each
 * violated field name and its constraint message in the {@code detail} string,
 * making it easy for callers to display meaningful validation feedback without
 * parsing the {@code errors} extension array.</p>
 *
 * <p>{@code spring.mvc.problemdetails.enabled=true} in {@code application.properties}
 * ensures the content type is {@code application/problem+json} on all error
 * responses produced by this class.</p>
 */
@ControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    /**
     * Overrides the default validation-failure handler to include per-field
     * violation details in the {@code detail} field.
     *
     * <p>Example {@code detail} value:
     * {@code "temperatureC: must be less than or equal to 60; windSpeedKph: must be greater than or equal to 0"}</p>
     */
    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {

        String detail = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
            .sorted()
            .collect(Collectors.joining("; "));

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        return createResponseEntity(problem, headers, status, request);
    }
}
