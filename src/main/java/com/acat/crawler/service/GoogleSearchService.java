package com.acat.crawler.service;

import com.acat.crawler.dto.SearchResult;
import org.htmlunit.WebClient;
import org.htmlunit.html.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class GoogleSearchService {

    private final WebClient webClient;

    @Value("${crawler.google-search-url}")
    private String googleSearchUrl;

    @Value("${crawler.base-url}")
    private String baseUrl;

    public List<SearchResult> search(String keyword, int pageNum) throws IOException {
        List<SearchResult> results = new ArrayList<>();
        String query = "site:" + baseUrl + " " + keyword;
        String url = googleSearchUrl + "?q=" + java.net.URLEncoder.encode(query, "UTF-8")
                + (pageNum > 0 ? "&start=" + (pageNum * 10) : "");

        log.info("Google search: {}", url);
        HtmlPage page = webClient.getPage(url);
        webClient.waitForBackgroundJavaScript(5000);

        String resultXPath = "/html/body/div[3]/div/div[11]/div/div[2]/div[2]/div/div/div";
        List<?> resultDivs = page.getByXPath(resultXPath);

        for (Object obj : resultDivs) {
            if (!(obj instanceof HtmlDivision)) continue;
            HtmlDivision div = (HtmlDivision) obj;

            try {
                String urlXPath = "div/div/div/div[1]/div/div/span/a";
                List<?> urlNodes = div.getByXPath(urlXPath);
                String resultUrl = null;
                if (!urlNodes.isEmpty() && urlNodes.get(0) instanceof HtmlAnchor) {
                    resultUrl = ((HtmlAnchor) urlNodes.get(0)).getHrefAttribute();
                }
                if (resultUrl == null) continue;
                if (!resultUrl.contains(baseUrl.replace("https://", "").replace("www.", ""))) continue;

                SearchResult sr = new SearchResult();
                sr.setUrl(resultUrl);

                List<?> titleNodes = div.getByXPath("div/div/div/div[1]/div/div/span/a/h3");
                if (!titleNodes.isEmpty()) {
                    sr.setTitle(((HtmlElement) titleNodes.get(0)).getTextContent().trim());
                }

                String snippet = div.getTextContent();
                if (snippet != null && snippet.length() > 200) {
                    snippet = snippet.substring(0, 200) + "...";
                }
                sr.setSnippet(snippet);
                results.add(sr);
            } catch (Exception e) {
                log.warn("解析搜索结果项失败: {}", e.getMessage());
            }
        }

        log.info("Google 搜索返回 {} 条结果 (keyword={}, page={})", results.size(), keyword, pageNum);
        return results;
    }

    public int getPageCount(String keyword) throws IOException {
        String query = "site:" + baseUrl + " " + keyword;
        String url = googleSearchUrl + "?q=" + java.net.URLEncoder.encode(query, "UTF-8");
        HtmlPage page = webClient.getPage(url);
        webClient.waitForBackgroundJavaScript(5000);

        String pagesNavXPath = "/html/body/div[3]/div/div[11]/div/div[3]/div/div[4]/table/tbody/tr";
        List<?> rows = page.getByXPath(pagesNavXPath);
        return rows.size();
    }
}
