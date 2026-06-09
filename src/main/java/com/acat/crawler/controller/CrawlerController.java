package com.acat.crawler.controller;

import com.acat.crawler.dto.CrawlRequest;
import com.acat.crawler.dto.CrawlResult;
import com.acat.crawler.dto.SearchResult;
import com.acat.crawler.service.CrawlerService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/crawler")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class CrawlerController {

    private final CrawlerService crawlerService;

    @GetMapping("/search")
    public List<SearchResult> search(@RequestParam String keyword,
                                     @RequestParam(defaultValue = "0") int page) throws IOException {
        return crawlerService.search(keyword, page);
    }

    @PostMapping("/crawl")
    public CrawlResult crawl(@RequestBody CrawlRequest request) {
        return crawlerService.crawl(request.getUrl());
    }

    @PostMapping("/crawl-chapter")
    public List<String> crawlChapter(@RequestParam String url) throws IOException {
        return crawlerService.crawlChapterContent(url);
    }
}
