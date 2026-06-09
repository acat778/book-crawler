package com.acat.crawler.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class CrawlResult {
    private boolean success;
    private String message;
    private String title;
    private String author;
    private String category;
    private Long bookId;
    private int chapterCount;
    private int crawledChapters;
}
