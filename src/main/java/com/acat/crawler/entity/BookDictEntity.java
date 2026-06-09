package com.acat.crawler.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_book_dict")
public class BookDictEntity {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private String code;
    private String name;
    private Integer isEnabled;
    private Integer isTree;
    private Integer scope;
    private String description;

    @TableLogic
    @TableField(select = false)
    private Integer isDeleted;
    @TableField(fill = FieldFill.INSERT)
    private Long createBy;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updateBy;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @Version
    @TableField(fill = FieldFill.INSERT)
    private Integer version;
}
